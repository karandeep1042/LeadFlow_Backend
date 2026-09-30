import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Task from '../models/Task.js';
import Document from '../models/Document.js';
import Brokerage from '../models/Brokerage.js';
import StageTrigger from '../models/StageTrigger.js';
import { sendLeadAdvisorAssignedEmail, sendClientInvitationEmail } from '../utils/emailService.js';
import { emitToBrokerage, emitToRole, emitToUser } from '../utils/socket.js';
import { notifyLeadIngestion, notifyStageUpdated, notifyTaskAssigned } from '../services/notificationService.js';
import { REQUIRED_COMPLIANCE_DOC_TYPES, ALLOWED_STAGE_TRANSITIONS, getStageDisplayName } from '../utils/constants.js';
import { DEFAULT_STAGE_CONFIGS } from '../utils/defaultAutomations.js';
import cacheService from '../services/cacheService.js';

export const invalidateLeadCaches = async (brokerageId, clientId = null) => {
  if (!brokerageId) return;
  try {
    const promises = [
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'leads', '*')),
      cacheService.del(cacheService.generateKey(brokerageId, 'dash', 'stats')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'client', '*')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'tasks', '*')),
    ];
    if (clientId) {
      const cId = typeof clientId === 'object' && clientId !== null ? (clientId._id || clientId.id) : clientId;
      if (cId) {
        promises.push(cacheService.del(cacheService.generateKey(brokerageId, 'client:portal', cId)));
      }
    }
    await Promise.all(promises);
  } catch (err) {
    console.warn('[Cache] Invalidation error for leads:', err.message);
  }
};

export const calculateLeadDocsSummary = async (leadId, clientId, brokerageId) => {
  const query = { brokerageId };
  const orConds = [];
  if (leadId) orConds.push({ leadId });
  if (clientId) {
    const rawClientId = typeof clientId === 'object' && clientId !== null ? (clientId._id || clientId.id) : clientId;
    if (rawClientId) orConds.push({ clientId: rawClientId });
  }

  if (orConds.length === 0) {
    return {
      totalRequired: REQUIRED_COMPLIANCE_DOC_TYPES.length,
      uploadedCount: 0,
      verifiedCount: 0,
      rejectedCount: 0,
      pendingCount: 0,
      missingCount: REQUIRED_COMPLIANCE_DOC_TYPES.length,
      unverifiedCount: REQUIRED_COMPLIANCE_DOC_TYPES.length,
      isComplianceComplete: false,
    };
  }

  query.$or = orConds;
  const docs = await Document.find(query).lean();

  const docsByType = new Map();
  for (const doc of docs) {
    const existing = docsByType.get(doc.docType);
    if (!existing || doc.status === 'verified' || (existing.status !== 'verified' && new Date(doc.updatedAt) > new Date(existing.updatedAt))) {
      docsByType.set(doc.docType, doc);
    }
  }

  let verifiedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;
  let missingCount = 0;

  for (const reqType of REQUIRED_COMPLIANCE_DOC_TYPES) {
    const doc = docsByType.get(reqType);
    if (!doc) {
      missingCount++;
    } else if (doc.status === 'verified') {
      verifiedCount++;
    } else if (doc.status === 'rejected') {
      rejectedCount++;
    } else {
      pendingCount++;
    }
  }

  const totalRequired = REQUIRED_COMPLIANCE_DOC_TYPES.length;
  const unverifiedCount = totalRequired - verifiedCount;
  const isComplianceComplete = verifiedCount >= totalRequired;

  return {
    totalRequired,
    uploadedCount: docsByType.size,
    verifiedCount,
    rejectedCount,
    pendingCount,
    missingCount,
    unverifiedCount,
    isComplianceComplete,
  };
};

const batchCalculateDocsSummary = async (leads, brokerageId) => {
  if (!leads || leads.length === 0) return new Map();

  const leadIds = [];
  const clientIds = [];

  for (const lead of leads) {
    if (lead._id) leadIds.push(lead._id);
    const cId = lead.clientId?._id || lead.clientId;
    if (cId) clientIds.push(cId);
  }

  const orConds = [];
  if (leadIds.length > 0) orConds.push({ leadId: { $in: leadIds } });
  if (clientIds.length > 0) orConds.push({ clientId: { $in: clientIds } });

  if (orConds.length === 0) return new Map();

  const allDocs = await Document.find({
    brokerageId,
    $or: orConds,
  }).lean();

  const docsByLeadId = new Map();
  const docsByClientId = new Map();

  for (const doc of allDocs) {
    if (doc.leadId) {
      const lKey = String(doc.leadId);
      if (!docsByLeadId.has(lKey)) docsByLeadId.set(lKey, []);
      docsByLeadId.get(lKey).push(doc);
    }
    if (doc.clientId) {
      const cKey = String(doc.clientId);
      if (!docsByClientId.has(cKey)) docsByClientId.set(cKey, []);
      docsByClientId.get(cKey).push(doc);
    }
  }

  const summaryMap = new Map();
  for (const lead of leads) {
    const lKey = String(lead._id);
    const cId = lead.clientId?._id || lead.clientId;
    const cKey = cId ? String(cId) : null;

    const relevantDocs = [
      ...(docsByLeadId.get(lKey) || []),
      ...(cKey ? (docsByClientId.get(cKey) || []) : []),
    ];

    const seenDocIds = new Set();
    const uniqueDocs = [];
    for (const d of relevantDocs) {
      const dId = String(d._id);
      if (!seenDocIds.has(dId)) {
        seenDocIds.add(dId);
        uniqueDocs.push(d);
      }
    }

    const docsByType = new Map();
    for (const doc of uniqueDocs) {
      const existing = docsByType.get(doc.docType);
      if (!existing || doc.status === 'verified' || (existing.status !== 'verified' && new Date(doc.updatedAt) > new Date(existing.updatedAt))) {
        docsByType.set(doc.docType, doc);
      }
    }

    let verifiedCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0;
    let missingCount = 0;

    for (const reqType of REQUIRED_COMPLIANCE_DOC_TYPES) {
      const doc = docsByType.get(reqType);
      if (!doc) {
        missingCount++;
      } else if (doc.status === 'verified') {
        verifiedCount++;
      } else if (doc.status === 'rejected') {
        rejectedCount++;
      } else {
        pendingCount++;
      }
    }

    const totalRequired = REQUIRED_COMPLIANCE_DOC_TYPES.length;
    const unverifiedCount = totalRequired - verifiedCount;
    const isComplianceComplete = verifiedCount >= totalRequired;

    summaryMap.set(lKey, {
      totalRequired,
      uploadedCount: docsByType.size,
      verifiedCount,
      rejectedCount,
      pendingCount,
      missingCount,
      unverifiedCount,
      isComplianceComplete,
    });
  }

  return summaryMap;
};


/**
 * Idempotent Stage Task Lifecycle Engine
 * 1. Supersedes/retires obsolete uncompleted stage tasks from other stages for this lead.
 * 2. Idempotently upserts/refreshes the active SLA task for targetStage without duplicating.
 * 3. Preserves custom admin tasks.
 */
export const syncStageTasks = async ({
  brokerageId,
  lead,
  targetStage,
  previousStage,
  assignedAdvisorId,
  resolvePendingTask = true,
}) => {
  try {
    const leadId = lead._id || lead.id;
    const effectiveAdvisorId = assignedAdvisorId || lead.assignedAdvisorId?._id || lead.assignedAdvisorId || null;

    // 1. If moving to terminal closed stages ('Lost', 'Declined', or archived)
    if (targetStage === 'Lost' || targetStage === 'Closed' || lead.isDeclined || lead.isArchived) {
      await Task.updateMany(
        {
          leadId,
          isCompleted: false,
        },
        {
          $set: {
            status: 'completed',
            isCompleted: true,
            completedAt: new Date(),
            completedReason: `Deal finalized in stage: ${targetStage}`,
          },
        }
      );
      return;
    }

    // 2. If advancing forward and resolvePendingTask is true, mark previousStage task as completed
    const isReverseMove = previousStage === 'Bank Submission' && targetStage === 'Document Collection';
    if (!isReverseMove && previousStage && resolvePendingTask) {
      await Task.updateMany(
        {
          leadId,
          isCompleted: false,
          stage: previousStage,
        },
        {
          $set: {
            status: 'completed',
            isCompleted: true,
            completedAt: new Date(),
            completedReason: `Completed on stage advance to ${targetStage}`,
          },
        }
      );
    }

    // 3. Supersede all other uncompleted tasks for this lead that do NOT belong to targetStage
    // (Including legacy tasks without an explicit stage property)
    await Task.updateMany(
      {
        leadId,
        isCompleted: false,
        $or: [
          { stage: { $ne: targetStage } },
          { stage: null },
          { stage: { $exists: false } },
        ],
      },
      {
        $set: {
          status: 'superseded',
          isCompleted: true,
          completedAt: new Date(),
          completedReason: isReverseMove
            ? `Superseded by stage regression to ${getStageDisplayName(targetStage)}`
            : `Superseded by stage transition to ${getStageDisplayName(targetStage)}`,
        },
      }
    );

    // 4. Find StageTrigger definition for targetStage (with fallback to DEFAULT_STAGE_CONFIGS)
    const trigger = await StageTrigger.findOne({
      brokerageId,
      stage: targetStage,
      isActive: true,
    });

    const defaultConfig = DEFAULT_STAGE_CONFIGS.find((c) => c.stage === targetStage);
    const rawTaskTitle = trigger?.taskTitle || defaultConfig?.taskTitle || `Complete ${getStageDisplayName(targetStage)} workflow for {{client_name}}`;
    const dueHours = trigger?.taskDueHours || defaultConfig?.taskDueHours || 24;
    const priority = trigger?.taskPriority || defaultConfig?.taskPriority || 'medium';

    const clientName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Client';
    const taskTitle = rawTaskTitle
      .replace(/\{\{client_name\}\}/g, clientName)
      .replace(/\{\{city\}\}/g, lead.city || 'Berlin');

    const newDueAt = new Date(Date.now() + dueHours * 60 * 60 * 1000);

    // Check if a task for this stage already exists on this lead
    let existingTask = await Task.findOne({
      leadId,
      stage: targetStage,
    });

    if (!existingTask) {
      const titlePrefix = rawTaskTitle.split('{{')[0].trim();
      if (titlePrefix) {
        existingTask = await Task.findOne({
          leadId,
          title: { $regex: titlePrefix, $options: 'i' },
        });
      }
    }

    if (existingTask) {
      // Idempotently reactivate and refresh deadline
      existingTask.title = taskTitle;
      existingTask.stage = targetStage;
      existingTask.isAutoGenerated = true;
      existingTask.status = 'pending';
      existingTask.isCompleted = false;
      existingTask.completedAt = null;
      existingTask.completedReason = null;
      existingTask.priority = priority;
      existingTask.dueAt = newDueAt;
      if (effectiveAdvisorId) {
        existingTask.assignedAdvisorId = effectiveAdvisorId;
      }
      await existingTask.save();

      if (effectiveAdvisorId) {
        notifyTaskAssigned({
          brokerageId,
          task: existingTask,
          lead,
          advisorId: effectiveAdvisorId,
        });
      }
    } else {
      // Create fresh task for this stage
      const createdTask = await Task.create({
        brokerageId,
        title: taskTitle,
        leadId,
        stage: targetStage,
        isAutoGenerated: true,
        status: 'pending',
        isCompleted: false,
        assignedAdvisorId: effectiveAdvisorId,
        priority,
        dueAt: newDueAt,
      });

      if (effectiveAdvisorId) {
        notifyTaskAssigned({
          brokerageId,
          task: createdTask,
          lead,
          advisorId: effectiveAdvisorId,
        });
      }
    }
  } catch (err) {
    console.error('[syncStageTasks Warning]:', err.message);
  }
};

export const getLeads = async (req, res) => {
  try {
    const brokerageId = req.user?.brokerageId;
    const sortedQuery = Object.keys(req.query || {})
      .sort()
      .reduce((acc, key) => {
        acc[key] = req.query[key];
        return acc;
      }, {});
    const cacheKey = cacheService.generateKey(
      brokerageId,
      'leads',
      `${req.user?.role}:${req.user?._id}:${JSON.stringify(sortedQuery)}`
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const conditions = [{ ...req.tenantFilter }];

    if (req.query.stage) {
      conditions.push({ stage: req.query.stage });
    }

    if (req.query.assignedTo) {
      if (req.query.assignedTo === 'unassigned') {
        conditions.push({ assignedAdvisorId: null });
      } else {
        conditions.push({ assignedAdvisorId: req.query.assignedTo });
      }
    }

    if (req.query.isDuplicate === 'true') {
      conditions.push({ isDuplicate: true });
    }

    if (req.query.minValue) {
      conditions.push({ loanAmount: { $gte: Number(req.query.minValue) } });
    }

    // Archive / Closed Deals filter:
    if (req.query.isArchived === 'true') {
      // Closed deals portfolio includes both disbursed/archived loans and declined cases
      conditions.push({
        $or: [
          { isArchived: true },
          { isDeclined: true },
        ],
      });
    } else if (req.query.isArchived === 'all') {
      // no archive filter
    } else {
      // Active pipeline deals only: not archived AND not declined
      conditions.push({ isArchived: { $ne: true } });
      conditions.push({ isDeclined: { $ne: true } });
    }

    if (req.query.search) {
      conditions.push({
        $or: [
          { firstName: { $regex: req.query.search, $options: 'i' } },
          { lastName: { $regex: req.query.search, $options: 'i' } },
          { email: { $regex: req.query.search, $options: 'i' } },
          { city: { $regex: req.query.search, $options: 'i' } },
        ],
      });
    }

    const filter = conditions.length > 1 ? { $and: conditions } : conditions[0];

    const baseScopeConditions = [{ ...req.tenantFilter }];
    if (req.query.assignedTo) {
      if (req.query.assignedTo === 'unassigned') {
        baseScopeConditions.push({ assignedAdvisorId: null });
      } else {
        baseScopeConditions.push({ assignedAdvisorId: req.query.assignedTo });
      }
    }
    const baseScopeFilter = baseScopeConditions.length > 1 ? { $and: baseScopeConditions } : baseScopeConditions[0];

    const [leads, activeCount, archivedCount] = await Promise.all([
      Lead.find(filter)
        .populate('assignedAdvisorId', 'name email phone role')
        .populate('clientId', 'name email phone role status')
        .populate('duplicateOf', 'firstName lastName email stage')
        .sort({ createdAt: -1 }),
      Lead.countDocuments({
        ...baseScopeFilter,
        isArchived: { $ne: true },
        isDeclined: { $ne: true },
      }),
      Lead.countDocuments({
        ...baseScopeFilter,
        $or: [{ isArchived: true }, { isDeclined: true }],
      }),
    ]);

    const summaryMap = await batchCalculateDocsSummary(leads, req.user.brokerageId);

    const enrichedLeads = leads.map((l) => {
      const obj = l.toObject();
      obj.docsSummary = summaryMap.get(String(l._id)) || {
        totalRequired: REQUIRED_COMPLIANCE_DOC_TYPES.length,
        uploadedCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
        pendingCount: 0,
        missingCount: REQUIRED_COMPLIANCE_DOC_TYPES.length,
        unverifiedCount: REQUIRED_COMPLIANCE_DOC_TYPES.length,
        isComplianceComplete: false,
      };
      return obj;
    });

    const responsePayload = {
      success: true,
      data: {
        leads: enrichedLeads,
        counts: {
          active: activeCount,
          archived: archivedCount,
        },
      },
    };

    cacheService.set(cacheKey, responsePayload, 300).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createLead = async (req, res) => {
  try {
    if (req.user.role === 'advisor') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Mortgage Advisors cannot manually create leads. Inbound leads are ingested automatically via webhooks or assigned by Brokerage Administrators.',
      });
    }

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
      assignedAdvisorId: assignedAdvisorId || null,
      isDuplicate: Boolean(existing),
      duplicateOf: existing ? existing._id : null,
      sourceName: 'Manual Entry (Admin)',
    });

    // Auto-create initial Stage 01 task (Call in 2h or trigger SLA)
    await syncStageTasks({
      brokerageId: req.user.brokerageId,
      lead: newLead,
      targetStage: 'New',
      previousStage: null,
      assignedAdvisorId: newLead.assignedAdvisorId || null,
    });

    const populated = await Lead.findById(newLead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    // Emit real-time creation event to the organization room
    emitToBrokerage(newLead.brokerageId, 'lead:created', populated);

    // Multi-role notification trigger for Advisors & Admins
    notifyLeadIngestion({ brokerageId: newLead.brokerageId, lead: populated });

    await invalidateLeadCaches(newLead.brokerageId);

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
    const { stage, resolvePendingTask = true, isRevision, selectedDocIds, reason } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // 2. Advisor Ownership Enforcement: Cannot modify deals assigned to a colleague
    const currentUserId = String(req.user._id || req.user.id);
    const assignedAdvisorId = lead.assignedAdvisorId ? String(lead.assignedAdvisorId) : null;

    let newlyClaimed = false;
    if (assignedAdvisorId && assignedAdvisorId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: This mortgage case is assigned to another advisor. Only the assigned advisor can advance its pipeline stage.',
      });
    }

    // 3. Status Guardrails
    if (lead.isDeclined) {
      return res.status(400).json({
        success: false,
        message: 'This financing case has been permanently declined and concluded. Status cannot be modified.',
      });
    }

    if (lead.isArchived) {
      return res.status(400).json({
        success: false,
        message: 'This case is archived. Please unarchive the lead before modifying its pipeline stage.',
      });
    }

    const previousStage = lead.stage;

    // Stage Guardrail 1: Cannot move a lead back to 'New' (Lead Ingestion) once claimed and progressed
    if (previousStage !== 'New' && stage === 'New') {
      return res.status(400).json({
        success: false,
        message: 'Stage Lock: Deals cannot be moved back to Lead Ingestion once claimed and progressed in the advisory pipeline.',
      });
    }

    // Stage Guardrails: Cannot move backward from Loan Offer ('Won') or Notary & Closing ('Lost')
    const terminalStages = ['Won', 'Lost', 'Approved', 'Closed Won', 'Closed Lost'];
    if (terminalStages.includes(previousStage) && stage !== previousStage) {
      // Only allow advancing Won -> Lost
      const isAllowedAdvancement = (previousStage === 'Won' || previousStage === 'Approved') && (stage === 'Lost' || stage === 'Closed Won');
      if (!isAllowedAdvancement) {
        return res.status(400).json({
          success: false,
          message: 'Stage Lock: Deals in Loan Offer or Notary & Closing stages have binding bank commitments and cannot be moved backward to earlier stages.',
        });
      }
    }

    // Sequential Progression Guardrail: Deals cannot skip stages
    if (previousStage !== stage) {
      const allowedNextStages = ALLOWED_STAGE_TRANSITIONS[previousStage] || [];
      if (!allowedNextStages.includes(stage)) {
        if (previousStage === 'Contacted' && stage === 'Bank Submission') {
          return res.status(400).json({
            success: false,
            message: 'Sequential Pipeline Rule: Deals must progress step-by-step through Document Collection before Bank Submission.',
          });
        }
        return res.status(400).json({
          success: false,
          message: `Invalid Stage Progression: Cannot transition directly from "${previousStage}" to "${stage}". Pipeline stages must progress sequentially.`,
        });
      }
    }

    // Document Verification Compliance Gate: Advancing to Bank Submission requires all required compliance docs to be verified
    if (stage === 'Bank Submission') {
      const docsSummary = await calculateLeadDocsSummary(lead._id, lead.clientId, lead.brokerageId);
      if (!docsSummary.isComplianceComplete) {
        return res.status(400).json({
          success: false,
          message: `Document Compliance Gate: Cannot advance to Bank Submission. Only ${docsSummary.verifiedCount} of ${docsSummary.totalRequired} required German mortgage compliance documents are verified (${docsSummary.unverifiedCount} missing or unverified).`,
          data: { docsSummary },
        });
      }
    }

    // 4. Auto-claim unassigned lead when an advisor advances it from the shared pool
    if (!assignedAdvisorId) {
      lead.assignedAdvisorId = req.user._id;
      newlyClaimed = true;

      // Transfer open/pending tasks for this lead to the claiming advisor
      await Task.updateMany(
        { leadId: lead._id, isCompleted: false },
        { assignedAdvisorId: req.user._id }
      );
    }

    lead.stage = stage;
    lead.notesList = lead.notesList || [];
    
    if (newlyClaimed) {
      lead.notesList.push({
        author: req.user.name || 'Mortgage Advisor',
        text: `Lead claimed by ${req.user.name || 'Mortgage Advisor'} and advanced from ${getStageDisplayName(previousStage)} to ${getStageDisplayName(stage)}.`,
        createdAt: new Date(),
      });
    } else {
      lead.notesList.push({
        author: req.user.name || 'Mortgage Advisor',
        text: `Pipeline stage updated from ${getStageDisplayName(previousStage)} to ${getStageDisplayName(stage)}.`,
        createdAt: new Date(),
      });
    }

    // 5. Automatic Client Portal Suspension when regressing to Initial Consultation from Document Collection or Bank Submission
    const isRegressingToConsultation = (previousStage === 'Document Collection' || previousStage === 'Bank Submission') && stage === 'Contacted';
    if (isRegressingToConsultation) {
      let clientUser = null;
      if (lead.clientId) {
        clientUser = await User.findById(lead.clientId);
      } else if (lead.email) {
        clientUser = await User.findOne({ email: lead.email.toLowerCase().trim(), brokerageId: lead.brokerageId });
      }

      if (clientUser) {
        clientUser.status = 'suspended';
        await clientUser.save();
        emitToBrokerage(lead.brokerageId, 'user:status_changed', {
          userId: clientUser._id,
          status: 'suspended',
          role: clientUser.role,
        });
      }

      lead.notesList.push({
        author: req.user.name || 'System Automation',
        text: `Client portal automatically deactivated and document upload permissions suspended upon moving case back to ${getStageDisplayName(stage)}.`,
        createdAt: new Date(),
      });
    }

    // 6. If advancing to Document Collection or later, reactivate suspended portal or auto-activate & send invitation email
    const isPortalStage = ['Document Collection', 'Bank Submission', 'Won', 'Lost', 'Approved', 'Closed Won'].includes(stage);
    let autoConverted = false;

    if (isPortalStage) {
      // Re-activate previously suspended client user if exists
      let existingClientUser = null;
      if (lead.clientId) {
        existingClientUser = await User.findById(lead.clientId);
      } else if (lead.email) {
        existingClientUser = await User.findOne({ email: lead.email.toLowerCase().trim(), brokerageId: lead.brokerageId });
      }

      if (existingClientUser && existingClientUser.status === 'suspended') {
        existingClientUser.status = 'active';
        existingClientUser.password = 'Password@123';
        await existingClientUser.save();
        emitToBrokerage(lead.brokerageId, 'user:status_changed', {
          userId: existingClientUser._id,
          status: 'active',
          role: existingClientUser.role,
        });
        lead.notesList.push({
          author: req.user.name || 'System Automation',
          text: `Client portal re-activated upon advancing case to "${getStageDisplayName(stage)}". Document upload access restored.`,
          createdAt: new Date(),
        });
      }

      // If client portal is not yet converted/activated, create client account
      if (!lead.isConverted && lead.email) {
        try {
          const normalizedEmail = lead.email.toLowerCase().trim();
          let clientUser = await User.findOne({ email: normalizedEmail });
          if (!clientUser) {
            clientUser = await User.create({
              name: `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Client',
              email: normalizedEmail,
              password: 'Password@123',
              role: 'client',
              brokerageId: lead.brokerageId,
              memberships: [
                {
                  brokerageId: lead.brokerageId,
                  role: 'client',
                  status: 'active',
                  joinedAt: new Date(),
                },
              ],
              phone: lead.phone || '',
              status: 'active',
              mustChangePassword: true,
              isTemporaryPassword: true,
            });
          } else {
            if (!clientUser.memberships) clientUser.memberships = [];
            const hasMem = clientUser.memberships.some(
              (m) =>
                m.brokerageId &&
                m.brokerageId.toString() === lead.brokerageId.toString() &&
                m.role === 'client'
            );
            if (!hasMem) {
              clientUser.memberships.push({
                brokerageId: lead.brokerageId,
                role: 'client',
                status: 'active',
                joinedAt: new Date(),
              });
            }
            clientUser.status = 'active';
            await clientUser.save();
          }

          lead.isConverted = true;
          lead.clientId = clientUser._id;
          autoConverted = true;

          lead.notesList.push({
            author: req.user.name || 'System Automation',
            text: `Client portal automatically activated upon advancing to stage "${getStageDisplayName(stage)}". Login credentials invitation dispatched to borrower.`,
            createdAt: new Date(),
          });
        } catch (convErr) {
          console.error('[Auto Client Portal Conversion Error]:', convErr.message);
        }
      }
    }

    await lead.save();

    // 5. Send onboarding or advisor assignment emails in background (non-blocking)
    if (autoConverted && lead.email) {
      (async () => {
        try {
          const brokerage = await Brokerage.findById(lead.brokerageId);
          const advisorUser = await User.findById(lead.assignedAdvisorId || req.user._id).select('name email phone role');
          const portalUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;

          await sendClientInvitationEmail({
            to: lead.email.toLowerCase().trim(),
            clientName: `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Valued Client',
            advisorName: advisorUser?.name || 'Your Assigned Advisor',
            advisorEmail: advisorUser?.email || 'advisor@leadflow.de',
            advisorPhone: advisorUser?.phone || '',
            brokerageName: brokerage?.name || 'LeadFlow Hypotheken GmbH',
            brokerageId: lead.brokerageId,
            portalUrl,
            temporaryPassword: 'Password@123',
            loanTarget: lead.loanAmount || lead.financialProfile?.targetLoanAmount,
            propertyCity: lead.city || lead.propertyPreferences?.city,
          });
          console.log(`[Stage Advance Auto-Portal Email] Sent to ${lead.email}`);
        } catch (emailErr) {
          console.error('[Stage Advance Portal Email Error]:', emailErr.message);
        }
      })();
    } else if (newlyClaimed && lead.email) {
      (async () => {
        try {
          const brokerage = await Brokerage.findById(lead.brokerageId);
          const advisorUser = await User.findById(req.user._id).select('name email phone role');
          if (advisorUser) {
            await sendLeadAdvisorAssignedEmail({
              lead,
              advisor: advisorUser,
              brokerageName: brokerage ? brokerage.name : 'LeadFlow Brokerage',
              brokerageId: lead.brokerageId,
              previousAdvisor: null,
            });
          }
        } catch (emailErr) {
          console.error('[Auto-Claim Advisor Notification Email Warning]:', emailErr.message);
        }
      })();
    }

    // 6. Bank Underwriting Revision handling on regression
    const isBankRevisionRegression = previousStage === 'Bank Submission' && stage === 'Document Collection';
    const rejectedDocsList = [];

    if (isBankRevisionRegression) {
      if (selectedDocIds && Array.isArray(selectedDocIds) && selectedDocIds.length > 0) {
        for (const docId of selectedDocIds) {
          const rejectedDoc = await Document.findOneAndUpdate(
            { _id: docId, ...req.tenantFilter },
            {
              status: 'rejected',
              advisorApproved: false,
              rejectionReason: reason || 'Document revision requested by bank underwriter.',
            },
            { new: true }
          );
          if (rejectedDoc) {
            rejectedDocsList.push({
              title: rejectedDoc.title || rejectedDoc.fileName || rejectedDoc.docType,
              docType: rejectedDoc.docType,
              reason: reason || rejectedDoc.rejectionReason || 'Please upload an updated compliant scan',
            });
            emitToBrokerage(lead.brokerageId, 'document:updated', rejectedDoc);
            const clientUserId = lead.clientId?._id || lead.clientId;
            if (clientUserId) emitToUser(clientUserId, 'document:updated', rejectedDoc);
          }
        }
        if (rejectedDocsList.length > 0) {
          await Brokerage.findByIdAndUpdate(lead.brokerageId, {
            $inc: { 'metrics.documentsRejectedCount': rejectedDocsList.length },
          });
          lead.notesList = lead.notesList || [];
          lead.notesList.push({
            author: req.user.name || 'Mortgage Advisor',
            text: `[Bank Underwriting Revision Requested]: Flagged ${rejectedDocsList.length} document(s) for revision (${rejectedDocsList.map((d) => d.title).join(', ')}). Reason: ${reason || 'Document revision requested by bank underwriter.'}`,
            createdAt: new Date(),
          });
          await lead.save();
        }
      } else {
        const existingRejected = await Document.find({
          brokerageId: lead.brokerageId,
          $or: [{ leadId: lead._id }, ...(lead.clientId ? [{ clientId: lead.clientId?._id || lead.clientId }] : [])],
          status: 'rejected',
        });
        existingRejected.forEach((d) => {
          rejectedDocsList.push({
            title: d.title || d.fileName || d.docType,
            docType: d.docType,
            reason: d.rejectionReason || reason || 'Document update requested by lender.',
          });
        });
        if (reason) {
          lead.notesList = lead.notesList || [];
          lead.notesList.push({
            author: req.user.name || 'Mortgage Advisor',
            text: `[Bank Underwriting Revision Requested]: Case moved back to Document Collection. Reason: ${reason}`,
            createdAt: new Date(),
          });
          await lead.save();
        }
      }
    }

    // 7. Intelligent Stage Task Lifecycle Sync
    await syncStageTasks({
      brokerageId: req.user.brokerageId,
      lead,
      targetStage: stage,
      previousStage,
      assignedAdvisorId: lead.assignedAdvisorId || req.user._id,
      resolvePendingTask,
    });

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    const docsSummary = await calculateLeadDocsSummary(lead._id, lead.clientId, lead.brokerageId);
    const populatedObj = populated.toObject();
    populatedObj.docsSummary = docsSummary;

    // Real-time broadcast to all advisors and admins in this organization
    emitToBrokerage(lead.brokerageId, 'lead:stage_updated', populatedObj);
    emitToBrokerage(lead.brokerageId, 'lead:updated', populatedObj);
    emitToBrokerage(lead.brokerageId, 'task:synced', { leadId: lead._id, stage });

    // Multi-role notifications (Client in-app + async email, and Brokerage Admin in-app)
    notifyStageUpdated({
      brokerageId: lead.brokerageId,
      lead: populatedObj,
      stage,
      previousStage,
      updatedByAdvisorName: req.user.name,
      updatedByAdvisorId: req.user._id,
      isBankRevisionRegression,
      revisionReason: reason || 'Document update requested by bank underwriter.',
      rejectedDocs: rejectedDocsList,
    });

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

    return res.status(200).json({ success: true, data: populatedObj });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const assignAdvisor = async (req, res) => {
  try {
    // Role enforcement: Mortgage Advisors cannot reassign leads. Only Brokerage Administrators can manage lead allocation.
    if (req.user.role === 'advisor') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Mortgage Advisors cannot reassign mortgage leads. Lead allocation is managed exclusively by Brokerage Administrators.',
      });
    }

    const { leadId } = req.params;
    const { assignedAdvisorId } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Deal Lock Enforcement: Cannot reassign advisor on Won, Lost, Declined, or Archived deals
    const isLockedStage = ['Won', 'Lost', 'Approved', 'Closed Won', 'Closed Lost'].includes(lead.stage);
    if (isLockedStage || lead.isDeclined || lead.isArchived) {
      return res.status(400).json({
        success: false,
        message: 'Advisor assignment is locked. Cannot reassign mortgage advisors on deals that have been approved, declined, or archived.',
      });
    }

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
          brokerageId: lead.brokerageId,
          previousAdvisor,
        });
      } catch (emailErr) {
        console.error('[Advisor Notification Email Error]:', emailErr.message);
      }
    }

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    const docsSummary = await calculateLeadDocsSummary(lead._id, lead.clientId, lead.brokerageId);
    const populatedObj = populated.toObject();
    populatedObj.docsSummary = docsSummary;

    // Real-time broadcast to organization
    emitToBrokerage(lead.brokerageId, 'lead:updated', populatedObj);

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

    return res.status(200).json({ success: true, data: populatedObj });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const convertToClient = async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Role check: If advisor, verify that lead belongs to this advisor (or auto-assign if unassigned)
    if (req.user.role === 'advisor') {
      const leadAdvisorId = lead.assignedAdvisorId?._id?.toString() || lead.assignedAdvisorId?.toString();
      if (leadAdvisorId && leadAdvisorId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: Mortgage Advisors can only convert and activate portal access for their assigned leads.',
        });
      }
      if (!leadAdvisorId) {
        lead.assignedAdvisorId = req.user._id;
      }
    }

    const normalizedEmail = (lead.email || '').toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: 'Lead does not have a valid email address for portal activation.' });
    }

    let clientUser = await User.findOne({ email: normalizedEmail });
    if (!clientUser) {
      clientUser = await User.create({
        name: `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Client',
        email: normalizedEmail,
        password: 'Password@123',
        role: 'client',
        brokerageId: lead.brokerageId,
        memberships: [
          {
            brokerageId: lead.brokerageId,
            role: 'client',
            status: 'active',
            joinedAt: new Date(),
          },
        ],
        phone: lead.phone || '',
        status: 'active',
        mustChangePassword: true,
        isTemporaryPassword: true,
      });
    } else {
      if (!clientUser.memberships) clientUser.memberships = [];
      const hasMem = clientUser.memberships.some(
        (m) =>
          m.brokerageId &&
          m.brokerageId.toString() === lead.brokerageId.toString() &&
          m.role === 'client'
      );
      if (!hasMem) {
        clientUser.memberships.push({
          brokerageId: lead.brokerageId,
          role: 'client',
          status: 'active',
          joinedAt: new Date(),
        });
      }
      clientUser.status = 'active';
      await clientUser.save();
    }

    lead.isConverted = true;
    lead.clientId = clientUser._id;
    lead.stage = 'Document Collection';
    lead.notesList = lead.notesList || [];
    lead.notesList.push({
      author: req.user.name || (req.user.role === 'advisor' ? 'Assigned Advisor' : 'Brokerage Admin'),
      text: 'Lead converted to Client Portal account (Access Active). Pipeline stage progressed to Document Collection.',
      createdAt: new Date(),
    });
    await lead.save();

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    const docsSummary = await calculateLeadDocsSummary(lead._id, lead.clientId, lead.brokerageId);
    const populatedObj = populated.toObject();
    populatedObj.docsSummary = docsSummary;

    // Real-time broadcast to organization
    emitToBrokerage(lead.brokerageId, 'lead:updated', populatedObj);

    // Send Client Portal credentials invitation email
    let emailResult = null;
    try {
      const brokerage = await Brokerage.findById(lead.brokerageId);
      const advisor = populated.assignedAdvisorId || (req.user.role === 'advisor' ? req.user : null);
      const portalUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;
      const temporaryPassword = 'Password@123';

      emailResult = await sendClientInvitationEmail({
        to: normalizedEmail,
        clientName: `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Valued Client',
        advisorName: advisor?.name || 'Your Assigned Advisor',
        advisorEmail: advisor?.email || 'advisor@leadflow.de',
        advisorPhone: advisor?.phone || '',
        brokerageName: brokerage?.name || 'LeadFlow Hypotheken GmbH',
        brokerageId: lead.brokerageId,
        portalUrl,
        temporaryPassword,
        loanTarget: lead.loanAmount || lead.financialProfile?.targetLoanAmount,
        propertyCity: lead.city || lead.propertyPreferences?.city,
      });
      console.log(`[Client Portal Activation Email Sent] To: ${normalizedEmail}, Success: ${emailResult?.success}, MessageId: ${emailResult?.messageId}`);
    } catch (emailErr) {
      console.error('[Client Invitation Email Trigger Error]', emailErr.message);
    }

    await invalidateLeadCaches(lead.brokerageId, clientUser._id);

    return res.status(200).json({
      success: true,
      message: `Lead converted to Client successfully and invitation email dispatched to ${normalizedEmail}.`,
      data: { clientId: clientUser._id, lead: populatedObj, emailSent: emailResult?.success ?? false },
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
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    // Real-time broadcast to organization
    emitToBrokerage(lead.brokerageId, 'lead:updated', populated);

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

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

    // Real-time broadcast to organization
    emitToBrokerage(lead.brokerageId, 'lead:note_added', { leadId: lead._id, note: newNote });

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

    return res.status(200).json({ success: true, data: newNote });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const declineLead = async (req, res) => {
  try {
    if (req.user.role === 'brokerage_admin') {
      return res.status(403).json({
        success: false,
        message: 'Brokerage administrators cannot alter case outcomes directly. Case actions are managed by Mortgage Advisors.',
      });
    }

    const { leadId } = req.params;
    const { reason } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const currentUserId = String(req.user._id || req.user.id);
    const assignedAdvisorId = lead.assignedAdvisorId ? String(lead.assignedAdvisorId) : null;
    if (assignedAdvisorId && assignedAdvisorId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Only the assigned mortgage advisor can decline this case.',
      });
    }

    const declineReasonText = reason || 'Financing requirements could not be met across partner banking network.';
    lead.isDeclined = true;
    lead.isArchived = true;
    lead.declineReason = declineReasonText;
    lead.declinedAt = new Date();
    lead.stage = 'Lost';
    lead.notesList = lead.notesList || [];
    lead.notesList.push({
      author: req.user.name || 'Mortgage Advisor',
      text: `[Case Declined]: Mortgage financing case permanently declined. Reason: ${declineReasonText}`,
      createdAt: new Date(),
    });

    await lead.save();

    // Complete/retire remaining open tasks for this lead
    await Task.updateMany(
      { leadId: lead._id, isCompleted: false },
      {
        $set: {
          isCompleted: true,
          status: 'completed',
          completedAt: new Date(),
          completedReason: `Case permanently declined: ${declineReasonText}`,
        },
      }
    );

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    emitToBrokerage(lead.brokerageId, 'lead:stage_updated', populated);
    emitToBrokerage(lead.brokerageId, 'lead:updated', populated);
    emitToBrokerage(lead.brokerageId, 'task:synced', { leadId: lead._id, stage: 'Lost' });

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const archiveLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { finalDisbursedAmount, closingNotes } = req.body;

    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const currentUserId = String(req.user._id || req.user.id);
    const assignedAdvisorId = lead.assignedAdvisorId ? String(lead.assignedAdvisorId) : null;
    const isAdvisor = req.user.role === 'advisor';

    if (isAdvisor && assignedAdvisorId && assignedAdvisorId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Only the assigned advisor or brokerage admin can finalize and archive this case.',
      });
    }

    const amount = Number(finalDisbursedAmount) || lead.loanAmount || 0;
    lead.isArchived = true;
    lead.archivedAt = new Date();
    lead.payoutCompletedAt = new Date();
    lead.finalDisbursedAmount = amount;
    if (closingNotes) lead.closingNotes = closingNotes;

    lead.notesList = lead.notesList || [];
    lead.notesList.push({
      author: req.user.name || 'Mortgage Desk',
      text: `[Deal Finalized & Archived]: Notary execution and payout confirmed (€${amount.toLocaleString('de-DE')}). Deal moved to Closed Portfolio. ${closingNotes ? `Notes: ${closingNotes}` : ''}`,
      createdAt: new Date(),
    });

    await lead.save();

    // Complete remaining open tasks for this lead
    await Task.updateMany(
      { leadId: lead._id, isCompleted: false },
      {
        $set: {
          isCompleted: true,
          status: 'completed',
          completedAt: new Date(),
          completedReason: 'Deal finalized in Closed Portfolio',
        },
      }
    );

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    emitToBrokerage(lead.brokerageId, 'lead:updated', populated);
    emitToBrokerage(lead.brokerageId, 'lead:archived', populated);
    emitToBrokerage(lead.brokerageId, 'task:synced', { leadId: lead._id, stage: 'Lost' });

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const unarchiveLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await Lead.findOne({ _id: leadId, ...req.tenantFilter });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    lead.isArchived = false;
    lead.isDeclined = false;
    lead.declineReason = '';
    lead.declinedAt = null;
    lead.notesList = lead.notesList || [];
    lead.notesList.push({
      author: req.user.name || 'Mortgage Desk',
      text: `[Deal Restored]: Deal restored from Closed Portfolio back to active pipeline.`,
      createdAt: new Date(),
    });

    await lead.save();

    const populated = await Lead.findById(lead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    emitToBrokerage(lead.brokerageId, 'lead:updated', populated);

    await invalidateLeadCaches(lead.brokerageId, lead.clientId);

    return res.status(200).json({ success: true, data: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

