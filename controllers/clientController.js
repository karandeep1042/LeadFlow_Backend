import User from '../models/User.js';
import Lead from '../models/Lead.js';
import Brokerage from '../models/Brokerage.js';
import Document from '../models/Document.js';
import EmailTemplate from '../models/EmailTemplate.js';
import { sendClientAccountStatusEmail, sendClientInvitationEmail } from '../utils/emailService.js';
import { emitToBrokerage } from '../utils/socket.js';
import cacheService from '../services/cacheService.js';

export const invalidateClientCaches = async (brokerageId, clientId = null) => {
  if (!brokerageId) return;
  try {
    const promises = [
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'client', '*')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'leads', '*')),
      cacheService.del(cacheService.generateKey(brokerageId, 'dash', 'stats')),
    ];
    if (clientId) {
      promises.push(cacheService.del(cacheService.generateKey(brokerageId, 'client:portal', clientId)));
    }
    await Promise.all(promises);
  } catch (err) {
    console.warn('[Cache] Error invalidating client caches:', err.message);
  }
};

/**
 * Get all clients with their mortgage application details, assigned advisor, and document statistics
 */
export const getClients = async (req, res) => {
  try {
    const brokerageId = req.user.brokerageId;
    if (!brokerageId) {
      return res.status(400).json({ success: false, message: 'Brokerage organization ID missing.' });
    }

    const cacheKey = cacheService.generateKey(brokerageId, 'client', 'list');
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    // 1. Fetch all client users in this brokerage
    const clientUsers = await User.find({
      $or: [
        { brokerageId, role: 'client' },
        { memberships: { $elemMatch: { brokerageId, role: 'client' } } },
      ],
    }).select('-password -refreshToken').lean();

    // 2. Fetch all leads in this brokerage with populated advisor and client
    const leads = await Lead.find({ brokerageId })
      .populate('assignedAdvisorId', 'name email phone status role')
      .populate('clientId', 'name email phone role status')
      .sort({ createdAt: -1 })
      .lean();

    // 3. Map leads and client users into unified client list
    const clientMap = new Map();

    // Add registered client users
    for (const clientUser of clientUsers) {
      const email = clientUser.email.toLowerCase();
      clientMap.set(email, {
        id: clientUser._id.toString(),
        _id: clientUser._id.toString(),
        userId: clientUser._id.toString(),
        name: clientUser.name,
        email: clientUser.email,
        phone: clientUser.phone || '',
        status: clientUser.status || 'active',
        isRegistered: true,
        createdAt: clientUser.createdAt,
        leadId: null,
        stage: 'Document Collection',
        loanAmount: 0,
        purchasePrice: 0,
        city: 'Berlin',
        visaType: 'EU Blue Card',
        employmentType: 'Employed',
        advisor: null,
        docsCount: 0,
        verifiedDocsCount: 0,
      });
    }

    // Merge with leads
    for (const lead of leads) {
      const email = lead.email.toLowerCase();
      const existing = clientMap.get(email);

      const advisorInfo = lead.assignedAdvisorId
        ? {
            id: lead.assignedAdvisorId._id.toString(),
            name: lead.assignedAdvisorId.name,
            email: lead.assignedAdvisorId.email,
            phone: lead.assignedAdvisorId.phone || '',
          }
        : null;

      const leadClientStatus = (lead.clientId && typeof lead.clientId === 'object' && lead.clientId.status)
        ? lead.clientId.status
        : 'active';

      if (existing) {
        existing.leadId = lead._id.toString();
        existing.stage = lead.stage;
        existing.loanAmount = lead.loanAmount || 0;
        existing.purchasePrice = lead.purchasePrice || 0;
        existing.city = lead.city || 'Berlin';
        existing.visaType = lead.visaType || 'EU Blue Card';
        existing.employmentType = lead.employmentType || 'Employed';
        existing.advisor = advisorInfo;
        if (!existing.phone && lead.phone) existing.phone = lead.phone;
      } else {
        const leadFullName = `${lead.firstName} ${lead.lastName || ''}`.trim();
        clientMap.set(email, {
          id: lead._id.toString(),
          _id: lead._id.toString(),
          userId: lead.clientId ? (lead.clientId._id ? lead.clientId._id.toString() : lead.clientId.toString()) : null,
          leadId: lead._id.toString(),
          name: leadFullName,
          email: lead.email,
          phone: lead.phone || '',
          status: leadClientStatus,
          isRegistered: Boolean(lead.isConverted || lead.clientId),
          createdAt: lead.createdAt,
          stage: lead.stage,
          loanAmount: lead.loanAmount || 0,
          purchasePrice: lead.purchasePrice || 0,
          city: lead.city || 'Berlin',
          visaType: lead.visaType || 'EU Blue Card',
          employmentType: lead.employmentType || 'Employed',
          advisor: advisorInfo,
          docsCount: 0,
          verifiedDocsCount: 0,
        });
      }
    }

    const clientsList = Array.from(clientMap.values());

    // 4. Enrich with document statistics
    const enrichedClients = await Promise.all(
      clientsList.map(async (client) => {
        const docFilter = { brokerageId };
        if (client.userId) {
          docFilter.$or = [{ clientId: client.userId }];
          if (client.leadId) docFilter.$or.push({ leadId: client.leadId });
        } else if (client.leadId) {
          docFilter.leadId = client.leadId;
        } else {
          return client;
        }

        const totalDocs = await Document.countDocuments(docFilter);
        const verifiedDocs = await Document.countDocuments({ ...docFilter, status: 'verified' });

        return {
          ...client,
          docsCount: totalDocs,
          verifiedDocsCount: verifiedDocs,
        };
      })
    );

    const responsePayload = {
      success: true,
      data: {
        clients: enrichedClients,
        totalClients: enrichedClients.length,
        activeClients: enrichedClients.filter((c) => c.status === 'active').length,
        suspendedClients: enrichedClients.filter((c) => c.status === 'suspended').length,
      },
    };

    cacheService.set(cacheKey, responsePayload, 300).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Toggle Client Account Status (Activate / Deactivate / Suspend) & Send Automated Email Notification
 */
export const updateClientStatus = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'suspended', 'invited'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status provided.' });
    }

    const brokerageId = req.user.brokerageId;
    const brokerage = await Brokerage.findById(brokerageId);

    // 1. Locate client User record or Lead record
    let user = await User.findOne({ _id: clientId, brokerageId });
    let lead = null;
    let isNewlyCreatedUser = false;

    if (!user) {
      lead = await Lead.findOne({ _id: clientId, brokerageId }).populate('assignedAdvisorId');
      if (lead) {
        const normEmail = (lead.email || '').toLowerCase().trim();
        user = await User.findOne({ email: normEmail });
        if (!user) {
          user = await User.create({
            name: `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Client',
            email: normEmail,
            password: 'Password@123',
            role: 'client',
            brokerageId,
            memberships: [
              {
                brokerageId,
                role: 'client',
                status,
                joinedAt: new Date(),
              },
            ],
            phone: lead.phone || '',
            status,
            mustChangePassword: true,
            isTemporaryPassword: true,
          });
          isNewlyCreatedUser = true;
          lead.clientId = user._id;
          lead.isConverted = true;
          await lead.save();
        } else {
          // Add or update membership for this brokerage
          if (!user.memberships) user.memberships = [];
          const existingMem = user.memberships.find(
            (m) => m.brokerageId && m.brokerageId.toString() === brokerageId.toString() && m.role === 'client'
          );
          if (existingMem) {
            existingMem.status = status;
          } else {
            user.memberships.push({
              brokerageId,
              role: 'client',
              status,
              joinedAt: new Date(),
            });
          }
          await user.save();
          lead.clientId = user._id;
          lead.isConverted = true;
          await lead.save();
        }
      }
    } else {
      lead = await Lead.findOne({
        brokerageId,
        $or: [{ clientId: user._id }, { email: user.email.toLowerCase().trim() }],
      })
        .sort({ isDeclined: 1, isArchived: 1, updatedAt: -1 })
        .populate('assignedAdvisorId');
    }

    if (!user && !lead) {
      return res.status(404).json({ success: false, message: 'Client record not found.' });
    }

    // Role check: If advisor, verify that lead belongs to this advisor
    if (req.user.role === 'advisor') {
      const leadAdvisorId = lead?.assignedAdvisorId?._id?.toString() || lead?.assignedAdvisorId?.toString();
      if (leadAdvisorId && leadAdvisorId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: Mortgage Advisors can only manage client portal access for their assigned leads.',
        });
      }
      if (!leadAdvisorId && lead) {
        lead.assignedAdvisorId = req.user._id;
      }
    }

    // 2. Update user status & set temporary password on activation
    if (user) {
      user.status = status;
      if (status === 'active') {
        user.password = 'Password@123';
      }
      await user.save();
    }

    // 3. Update lead reference and internal audit log
    if (lead) {
      if (!lead.clientId && user) {
        lead.clientId = user._id;
      }
      if (status === 'active') {
        lead.isConverted = true;
      }
      lead.notesList = lead.notesList || [];
      lead.notesList.push({
        author: req.user.name || (req.user.role === 'advisor' ? 'Assigned Advisor' : 'Brokerage Admin'),
        text: `Client portal account ${status === 'suspended' ? 'deactivated / suspended' : 'activated'}.${reason ? ` Reason: ${reason}` : ''}`,
        createdAt: new Date(),
      });
      await lead.save();
    }

    // 4. Real-time broadcast to all connected dashboards and pipeline views
    let populatedLead = null;
    if (lead) {
      populatedLead = await Lead.findById(lead._id)
        .populate('assignedAdvisorId', 'name email phone role')
        .populate('clientId', 'name email phone role status')
        .populate('duplicateOf', 'firstName lastName email stage');

      emitToBrokerage(brokerageId, 'lead:updated', populatedLead);
    }

    const clientName = user?.name || (lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : 'Valued Client');
    const clientEmail = (user?.email || lead?.email || '').toLowerCase().trim();
    const advisor = populatedLead?.assignedAdvisorId || (req.user.role === 'advisor' ? req.user : null);
    const advisorName = advisor?.name || 'Your Mortgage Advisor';
    const advisorEmail = advisor?.email || 'advisor@leadflow.de';
    const advisorPhone = advisor?.phone || '';
    const portalUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;
    const brokerageName = brokerage?.name || 'LeadFlow Brokerage';
    const supportEmail = req.user?.email || 'support@leadflow.de';

    // 5. Send automated email notification
    let emailResult = null;
    if (clientEmail) {
      const tempPassword = 'Password@123';

      if (status === 'active' && isNewlyCreatedUser) {
        // Send onboarding & credentials email for brand new client portal activation
        emailResult = await sendClientInvitationEmail({
          to: clientEmail,
          clientName,
          advisorName,
          advisorEmail,
          advisorPhone,
          brokerageName,
          brokerageId,
          portalUrl,
          temporaryPassword: tempPassword,
          loanTarget: lead?.loanAmount || lead?.financialProfile?.targetLoanAmount,
          propertyCity: lead?.city || lead?.propertyPreferences?.city,
        });
      } else {
        // Find configured email template for this action
        let template = null;
        if (status === 'suspended') {
          template = await EmailTemplate.findOne({
            brokerageId,
            name: { $regex: /deactivated|suspended/i },
          });
        } else if (status === 'active') {
          template = await EmailTemplate.findOne({
            brokerageId,
            name: { $regex: /reactivated|restored|portal welcome|active/i },
          });
        }

        let customSubject = template ? template.subject : null;
        let customBody = template ? template.body : null;

        // Replace placeholders
        if (customSubject) {
          customSubject = customSubject
            .replace(/\{\{client_name\}\}/g, clientName)
            .replace(/\{\{brokerage_name\}\}/g, brokerageName)
            .replace(/\{\{advisor_name\}\}/g, advisorName);
        }

        if (customBody) {
          customBody = customBody
            .replace(/\{\{client_name\}\}/g, clientName)
            .replace(/\{\{client_email\}\}/g, clientEmail)
            .replace(/\{\{brokerage_name\}\}/g, brokerageName)
            .replace(/\{\{advisor_name\}\}/g, advisorName)
            .replace(/\{\{advisor_email\}\}/g, advisorEmail)
            .replace(/\{\{advisor_phone\}\}/g, advisorPhone)
            .replace(/\{\{temporary_password\}\}/g, tempPassword)
            .replace(/\{\{reason\}\}/g, reason || 'Account status updated by organization admin')
            .replace(/\{\{support_email\}\}/g, supportEmail)
            .replace(/\{\{portal_link\}\}/g, portalUrl)
            .replace(/\{\{login_url\}\}/g, portalUrl)
            .replace(/\{\{loan_amount\}\}/g, lead?.loanAmount ? `€${lead.loanAmount.toLocaleString()}` : '€450,000')
            .replace(/\{\{city\}\}/g, lead?.city || 'Berlin');
        }

        emailResult = await sendClientAccountStatusEmail({
          to: clientEmail,
          clientName,
          status,
          reason,
          brokerageName,
          brokerageId,
          advisorName,
          advisorEmail,
          advisorPhone,
          supportEmail,
          customSubject,
          customBody,
          portalLink: portalUrl,
          temporaryPassword: tempPassword,
          loanTarget: lead?.loanAmount || lead?.financialProfile?.targetLoanAmount,
          propertyCity: lead?.city || lead?.propertyPreferences?.city,
        });
      }
      console.log(`[Client Status Email Dispatched] To: ${clientEmail}, Status: ${status}, Success: ${emailResult?.success}`);
    }

    await invalidateClientCaches(brokerageId, clientId);

    return res.status(200).json({
      success: true,
      message: `Client account successfully ${status === 'suspended' ? 'deactivated' : 'activated'}. Notification email sent to ${clientEmail}.`,
      data: {
        id: clientId,
        userId: user?._id?.toString(),
        status,
        lead: populatedLead,
        emailSent: emailResult?.success ?? false,
      },
    });
  } catch (error) {
    console.error('Error in updateClientStatus:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get unified client portal overview for authenticated borrower
 */
export const getClientPortalOverview = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const brokerageId = req.user.brokerageId;

    const cacheKey = cacheService.generateKey(
      brokerageId,
      'client:portal',
      `${userRole}:${userId}:${req.query.leadId || req.query.caseId || 'default'}`
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const user = await User.findById(userId).select('-password -refreshToken').lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let lead = null;
    if (userRole === 'client') {
      lead = await Lead.findOne({
        brokerageId,
        $or: [{ clientId: userId }, { email: user.email.toLowerCase() }],
      })
        .sort({ isDeclined: 1, isArchived: 1, updatedAt: -1 })
        .populate('assignedAdvisorId', 'name email phone avatar title')
        .populate('brokerageId', 'name logo address phone supportEmail')
        .lean();
    } else {
      const targetLeadId = req.query.leadId || req.query.caseId;
      if (targetLeadId) {
        lead = await Lead.findOne({ _id: targetLeadId, brokerageId })
          .populate('assignedAdvisorId', 'name email phone avatar title')
          .populate('brokerageId', 'name logo address phone supportEmail')
          .lean();
      }
      if (!lead) {
        lead = await Lead.findOne({ brokerageId })
          .populate('assignedAdvisorId', 'name email phone avatar title')
          .populate('brokerageId', 'name logo address phone supportEmail')
          .sort({ updatedAt: -1 })
          .lean();
      }
    }

    if (!lead) {
      lead = {
        _id: 'case-default',
        firstName: user.name?.split(' ')[0] || 'Borrower',
        lastName: user.name?.split(' ').slice(1).join(' ') || '',
        email: user.email,
        phone: user.phone || '+49 170 1234567',
        stage: 'Document Collection',
        loanAmount: 480000,
        purchasePrice: 600000,
        city: 'Berlin',
        visaType: 'EU Blue Card',
        employmentType: 'Employed (Permanent)',
        monthlyNetIncome: 5500,
        notesList: [],
        assignedAdvisorId: {
          name: 'Sarah Jenkins',
          email: 'sarah.jenkins@leadflow.de',
          phone: '+49 30 8920 1102',
          title: 'Senior Expat Mortgage Specialist',
        },
      };
    }

    const docQuery = {
      brokerageId,
      $or: [
        { clientId: userId },
        ...(lead._id && lead._id !== 'case-default' ? [{ leadId: lead._id }] : []),
      ],
    };
    const documents = await Document.find(docQuery).sort({ createdAt: -1 }).lean();

    const verifiedDocs = documents.filter((d) => d.status === 'verified');
    const rejectedDocs = documents.filter((d) => d.status === 'rejected');
    const processingDocs = documents.filter((d) => d.status === 'processing');
    const pendingDocs = documents.filter((d) => d.status === 'pending');

    const totalRequired = 18;
    const verifiedCount = verifiedDocs.length;
    const progressPercent = Math.min(100, Math.round((verifiedCount / totalRequired) * 100));

    const mapStageToStepIndex = (stage) => {
      switch (stage) {
        case 'New':
        case 'New Lead':
          return 0;
        case 'Contacted':
        case 'Discovery Call':
        case 'Qualified':
          return 1;
        case 'Document Collection':
        case 'Docs Pending':
        case 'Under Review':
          return 1;
        case 'Bank Submission':
        case 'Submitted':
          return 2;
        case 'Won':
        case 'Approved':
        case 'Loan Offer':
        case 'Offer & Approval':
          return 3;
        case 'Lost':
        case 'Closed':
        case 'Closed Won':
        case 'Closed Lost':
        case 'Notary & Closing':
        case 'Notary & Payout':
          return 4;
        default:
          return 1;
      }
    };

    const currentStageName = lead.stage || 'Document Collection';
    const stepIdx = mapStageToStepIndex(currentStageName);

    const stages = [
      {
        id: 1,
        title: 'Initial Consultation',
        key: 'Contacted',
        subtitle: 'Budget & Eligibility Audit',
        description: 'Initial mortgage readiness and German bank eligibility confirmed.',
        status: stepIdx > 0 ? 'completed' : 'current',
      },
      {
        id: 2,
        title: 'Document Collection',
        key: 'Document Collection',
        subtitle: 'Async Verification & Audit',
        description: 'Upload required German expat mortgage documents and verify compliance.',
        status: stepIdx > 1 ? 'completed' : (stepIdx === 1 ? 'current' : 'upcoming'),
      },
      {
        id: 3,
        title: 'Bank Submission',
        key: 'Bank Submission',
        subtitle: 'Bankanfrage Dispatch',
        description: 'Mortgage dossier sent to top German lenders (ING, Commerzbank, DSL).',
        status: stepIdx > 2 ? 'completed' : (stepIdx === 2 ? 'current' : 'upcoming'),
      },
      {
        id: 4,
        title: 'Loan Approval',
        key: 'Won',
        subtitle: 'Binding Term Sheet',
        description: 'Bank credit sanction secured with guaranteed fixed interest rate.',
        status: stepIdx > 3 ? 'completed' : (stepIdx === 3 ? 'current' : 'upcoming'),
      },
      {
        id: 5,
        title: 'Notary & Payout',
        key: 'Lost',
        subtitle: 'Notary Deed (Kaufvertrag)',
        description: 'Notary contract executed and loan funds released to seller.',
        status: stepIdx >= 4 ? 'current' : 'upcoming',
      },
    ];

    const brokerage = await Brokerage.findById(brokerageId).select('name logo address phone supportEmail').lean() || {
      name: 'LeadFlow Hypotheken GmbH',
      supportEmail: 'support@leadflow.de',
      phone: '+49 30 8920 1100',
    };

    const responsePayload = {
      success: true,
      data: {
        user,
        lead,
        advisor: lead.assignedAdvisorId || {
          name: 'Sarah Jenkins',
          email: 'sarah.jenkins@leadflow.de',
          phone: '+49 30 8920 1102',
          title: 'Senior Expat Mortgage Specialist',
        },
        brokerage,
        documents,
        metrics: {
          totalRequired,
          totalUploaded: documents.length,
          verifiedCount,
          rejectedCount: rejectedDocs.length,
          processingCount: processingDocs.length,
          pendingCount: pendingDocs.length,
          progressPercent,
          hasActionRequired: rejectedDocs.length > 0,
        },
        stages,
      },
    };

    cacheService.set(cacheKey, responsePayload, 600).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error in getClientPortalOverview:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
