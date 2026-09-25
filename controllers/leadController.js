import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Task from '../models/Task.js';
import Brokerage from '../models/Brokerage.js';
import StageTrigger from '../models/StageTrigger.js';
import { sendLeadAdvisorAssignedEmail } from '../utils/emailService.js';

export const getLeads = async (req, res) => {
  try {
    const filter = { ...req.tenantFilter };
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.assignedTo) {
      if (req.query.assignedTo === 'unassigned') {
        filter.assignedAdvisorId = null;
      } else {
        filter.assignedAdvisorId = req.query.assignedTo;
      }
    }
    if (req.query.isDuplicate === 'true') filter.isDuplicate = true;
    if (req.query.minValue) filter.loanAmount = { $gte: Number(req.query.minValue) };

    if (req.query.search) {
      filter.$or = [
        { firstName: { $regex: req.query.search, $options: 'i' } },
        { lastName: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
        { city: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const leads = await Lead.find(filter)
      .populate('assignedAdvisorId', 'name email')
      .populate('duplicateOf', 'firstName lastName email stage')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: { leads } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createLead = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, loanAmount, purchasePrice, city, visaType, employmentType, monthlyNetIncome, notes, assignedAdvisorId } = req.body;
    if (!firstName || !email) {
      return res.status(400).json({ success: false, message: 'First name and email are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check Duplicate within brokerage
    const existing = await Lead.findOne({
      brokerageId: req.user.brokerageId,
      email: normalizedEmail,
    });

    const newLead = await Lead.create({
      brokerageId: req.user.brokerageId,
      firstName: firstName.trim(),
      lastName: (lastName || '').trim(),
      email: normalizedEmail,
      phone: phone || '',
      loanAmount: Number(loanAmount) || 0,
      purchasePrice: Number(purchasePrice) || 0,
      city: city || 'Berlin',
      visaType: visaType || 'EU Blue Card',
      employmentType: employmentType || 'Employed',
      monthlyNetIncome: Number(monthlyNetIncome) || 0,
      notes: notes || '',
      stage: 'New',
      assignedAdvisorId: assignedAdvisorId || (req.user.role === 'advisor' ? req.user._id : null),
      isDuplicate: Boolean(existing),
      duplicateOf: existing ? existing._id : null,
      sourceName: 'Manual Entry',
    });

    // Auto-create initial task (Call in 2h)
    await Task.create({
      brokerageId: req.user.brokerageId,
      title: `Initial Outreach Call to ${newLead.firstName} ${newLead.lastName}`,
      leadId: newLead._id,
      assignedAdvisorId: newLead.assignedAdvisorId,
      priority: 'high',
      dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const populated = await Lead.findById(newLead._id).populate('assignedAdvisorId', 'name email');
    return res.status(201).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateLeadStage = async (req, res) => {
  try {
    // 1. Role enforcement: Brokerage admin cannot change status of lead in pipeline
    if (req.user.role === 'brokerage_admin') {
      return res.status(403).json({
        success: false,
        message: 'Brokerage administrators cannot alter lead pipeline stages directly. Pipeline stages are managed exclusively by Mortgage Advisors.',
      });
    }

    const { leadId } = req.params;
    const { stage } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const previousStage = lead.stage;
    lead.stage = stage;
    lead.notesList = lead.notesList || [];
    lead.notesList.push({
      author: req.user.name || 'Mortgage Advisor',
      text: `Pipeline stage updated from ${previousStage} to ${stage}.`,
      createdAt: new Date(),
    });
    await lead.save();

    // Check StageTrigger automation
    try {
      const trigger = await StageTrigger.findOne({
        brokerageId: req.user.brokerageId,
        stage,
        isActive: true,
      });

      if (trigger && trigger.taskTitle) {
        const taskTitle = trigger.taskTitle
          .replace(/\{\{client_name\}\}/g, `${lead.firstName} ${lead.lastName}`.trim())
          .replace(/\{\{city\}\}/g, lead.city || 'Berlin');

        await Task.create({
          brokerageId: req.user.brokerageId,
          title: taskTitle,
          leadId: lead._id,
          assignedAdvisorId: lead.assignedAdvisorId || null,
          priority: trigger.taskPriority || 'medium',
          dueAt: new Date(Date.now() + (trigger.taskDueHours || 24) * 60 * 60 * 1000),
        });
      }
    } catch (triggerErr) {
      console.error('[Automation Trigger Warning]:', triggerErr.message);
    }

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('duplicateOf', 'firstName lastName email stage');

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const assignAdvisor = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { assignedAdvisorId } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    let previousAdvisor = null;
    if (lead.assignedAdvisorId) {
      previousAdvisor = await User.findById(lead.assignedAdvisorId).select('name email phone role');
    }

    let assignedAdvisor = null;
    if (assignedAdvisorId) {
      // Find advisor in the same organization
      assignedAdvisor = await User.findOne({
        _id: assignedAdvisorId,
        brokerageId: lead.brokerageId,
        role: { $in: ['advisor', 'brokerage_admin'] },
      }).select('name email phone role');

      if (!assignedAdvisor) {
        return res.status(400).json({
          success: false,
          message: 'Selected advisor not found in your organization.',
        });
      }

      lead.assignedAdvisorId = assignedAdvisor._id;

      // Transfer open/pending tasks for this lead to the new advisor
      await Task.updateMany(
        { leadId: lead._id, isCompleted: false },
        { assignedAdvisorId: assignedAdvisor._id }
      );

      // Audit note in lead timeline
      lead.notesList = lead.notesList || [];
      lead.notesList.push({
        author: req.user.name || 'Brokerage Admin',
        text: `Assigned Mortgage Advisor to ${assignedAdvisor.name} (${assignedAdvisor.email}). Current stage retained: ${lead.stage}.`,
        createdAt: new Date(),
      });
    } else {
      lead.assignedAdvisorId = null;
      lead.notesList = lead.notesList || [];
      lead.notesList.push({
        author: req.user.name || 'Brokerage Admin',
        text: `Mortgage Advisor assignment removed (Lead is now unassigned). Current stage retained: ${lead.stage}.`,
        createdAt: new Date(),
      });
    }

    await lead.save();

    // Automatically send email notification to the borrower about their assigned mortgage advisor
    if (assignedAdvisor && lead.email) {
      try {
        const brokerage = await Brokerage.findById(lead.brokerageId);
        await sendLeadAdvisorAssignedEmail({
          lead,
          advisor: assignedAdvisor,
          brokerageName: brokerage ? brokerage.name : 'LeadFlow Brokerage',
          previousAdvisor,
        });
      } catch (emailErr) {
        console.error('[Advisor Notification Email Error]:', emailErr.message);
      }
    }

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('duplicateOf', 'firstName lastName email stage');

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const convertToClient = async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    let clientUser = await User.findOne({ email: lead.email });
    if (!clientUser) {
      clientUser = await User.create({
        name: `${lead.firstName} ${lead.lastName}`.trim(),
        email: lead.email,
        password: 'Password@123',
        role: 'client',
        brokerageId: lead.brokerageId,
        phone: lead.phone,
        status: 'active',
      });
    }

    lead.isConverted = true;
    lead.clientId = clientUser._id;
    lead.stage = 'Document Collection';
    await lead.save();

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email')
      .populate('duplicateOf', 'firstName lastName email stage');

    return res.status(200).json({
      success: true,
      message: 'Lead converted to Client successfully.',
      data: { clientId: clientUser._id, lead: populated },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const resolveDuplicate = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { action } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    lead.isDuplicate = false;
    lead.duplicateResolved = true;
    await lead.save();

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email')
      .populate('duplicateOf', 'firstName lastName email stage');

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addNote = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { note } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const newNote = {
      author: req.user.name,
      text: note,
      createdAt: new Date(),
    };

    lead.notesList.push(newNote);
    await lead.save();

    return res.status(200).json({ success: true, data: newNote });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

