import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Brokerage from '../models/Brokerage.js';
import { emitToBrokerage, emitToRole, emitToUser, emitToPlatformAdmins } from '../utils/socket.js';
import { sendStageMilestoneEmail, sendDocumentRevisionEmail } from '../utils/emailService.js';
import { getStageDisplayName } from '../utils/constants.js';

/**
 * Persists a notification to MongoDB and emits real-time WebSocket events.
 */
export const createNotification = async ({
  brokerageId = null,
  recipientId = null,
  recipientRole = 'all',
  title,
  message,
  type = 'general',
  data = {},
}) => {
  try {
    // If not a platform admin notification and missing brokerageId, ignore
    if (!brokerageId && recipientRole !== 'platform_admin' && !recipientId) return null;

    const notification = await Notification.create({
      brokerageId: brokerageId || null,
      recipientId: recipientId || null,
      recipientRole,
      title,
      message,
      type,
      data,
    });

    // Real-time dispatch via Socket.IO with strict role/user targeting
    if (recipientId) {
      emitToUser(recipientId, 'notification:new', notification);
    } else if (recipientRole === 'platform_admin') {
      emitToPlatformAdmins('notification:new', notification);
    } else if (recipientRole && recipientRole !== 'all') {
      if (brokerageId) {
        emitToRole(brokerageId, recipientRole, 'notification:new', notification);
      }
    } else if (brokerageId) {
      emitToBrokerage(brokerageId, 'notification:new', notification);
    }

    return notification;
  } catch (error) {
    console.error('[NotificationService Error] Failed to create notification:', error.message);
    return null;
  }
};

/**
 * 1. Lead Ingestion Notification
 * Dispatched to Advisors, Brokerage Admins, and Platform Admins when a new lead arrives.
 */
export const notifyLeadIngestion = async ({ brokerageId, lead }) => {
  try {
    if (!brokerageId || !lead) return;

    const leadName = `${lead.firstName || 'New'} ${lead.lastName || 'Borrower'}`.trim();
    const city = lead.city || 'Berlin';
    const amountStr = lead.loanAmount ? ` (€${Number(lead.loanAmount).toLocaleString()})` : '';

    let brokerageName = 'Workspace';
    try {
      const brokerage = await Brokerage.findById(brokerageId).select('name');
      if (brokerage?.name) brokerageName = brokerage.name;
    } catch (_) {}

    // Notify Advisors
    await createNotification({
      brokerageId,
      recipientRole: 'advisor',
      title: 'New Lead Ingestion',
      message: `${leadName} from ${city}${amountStr} arrived in the unassigned pool.`,
      type: 'lead_ingested',
      data: { leadId: lead._id, stage: 'New', url: '/advisor/pipeline' },
    });

    // Notify Brokerage Admins
    await createNotification({
      brokerageId,
      recipientRole: 'brokerage_admin',
      title: 'New Lead Ingested',
      message: `${leadName} from ${city}${amountStr} registered into workspace.`,
      type: 'lead_ingested',
      data: { leadId: lead._id, stage: 'New', url: '/admin/dashboard' },
    });

    // Notify Platform Admins globally
    await createNotification({
      brokerageId,
      recipientRole: 'platform_admin',
      title: 'New Lead Ingested',
      message: `${leadName}${amountStr} registered at ${brokerageName} (${city}).`,
      type: 'lead_ingested',
      data: { leadId: lead._id, brokerageId, stage: 'New', url: '/platform-admin/analytics' },
    });
  } catch (err) {
    console.error('[NotificationService] notifyLeadIngestion error:', err.message);
  }
};

/**
 * 2. Task Assigned Notification
 * Dispatched to the assigned Advisor when a new task is created/assigned.
 */
export const notifyTaskAssigned = async ({ brokerageId, task, lead, advisorId }) => {
  try {
    if (!brokerageId || !task || !advisorId) return;

    const leadName = lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : 'Mortgage Deal';
    const dueDate = task.dueAt ? new Date(task.dueAt).toLocaleDateString('de-DE', { month: 'short', day: 'numeric' }) : 'Soon';

    await createNotification({
      brokerageId,
      recipientId: advisorId,
      recipientRole: 'advisor',
      title: 'New Task Assigned',
      message: `"${task.title}" for ${leadName} (Due: ${dueDate}).`,
      type: 'task_assigned',
      data: { taskId: task._id, leadId: lead?._id, url: '/advisor/tasks' },
    });
  } catch (err) {
    console.error('[NotificationService] notifyTaskAssigned error:', err.message);
  }
};

/**
 * 3. Task Completed Notification
 * Dispatched to Brokerage Admin when an advisor completes a task.
 */
export const notifyTaskCompleted = async ({ brokerageId, task, lead, advisorName }) => {
  try {
    if (!brokerageId || !task) return;

    const leadName = lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : 'Mortgage Deal';
    const advisor = advisorName || 'Advisor';

    await createNotification({
      brokerageId,
      recipientRole: 'brokerage_admin',
      title: 'Task Completed',
      message: `${advisor} completed "${task.title}" for ${leadName}.`,
      type: 'task_completed',
      data: { taskId: task._id, leadId: lead?._id, url: '/advisor/tasks' },
    });
  } catch (err) {
    console.error('[NotificationService] notifyTaskCompleted error:', err.message);
  }
};


/**
 * 4. Stage Status Updated Notification
 * Dispatched to Client (in-app + asynchronous worker email) and Brokerage Admin.
 */
export const notifyStageUpdated = async ({
  brokerageId,
  lead,
  stage,
  previousStage,
  updatedByAdvisorName,
  updatedByAdvisorId,
  isBankRevisionRegression = false,
  revisionReason = '',
  rejectedDocs = [],
}) => {
  try {
    if (!brokerageId || !lead) return;

    const leadName = `${lead.firstName || 'Valued'} ${lead.lastName || 'Client'}`.trim();
    let clientId = lead.clientId?._id || lead.clientId;

    // Resolve client User ID if not explicitly set on lead
    if (!clientId && lead.email) {
      try {
        const clientUser = await User.findOne({
          email: lead.email.toLowerCase().trim(),
          brokerageId,
        }).select('_id');
        if (clientUser) {
          clientId = clientUser._id;
        }
      } catch (findErr) {
        console.error('[NotificationService] Client lookup error in notifyStageUpdated:', findErr.message);
      }
    }

    const isRegression = Boolean(isBankRevisionRegression) || (previousStage === 'Bank Submission' && stage === 'Document Collection');

    // 1. Notify Client (In-App)
    if (clientId) {
      if (isRegression) {
        const docCount = rejectedDocs && rejectedDocs.length > 0 ? rejectedDocs.length : 0;
        const docCountStr = docCount > 0 ? ` (${docCount} document${docCount > 1 ? 's' : ''} flagged)` : '';
        const docNamesStr = docCount > 0 ? ` for ${rejectedDocs.map((d) => d.title || d.docType).join(', ')}` : '';
        const reasonStr = revisionReason ? `: "${revisionReason}"` : '';

        await createNotification({
          brokerageId,
          recipientId: clientId,
          recipientRole: 'client',
          title: 'Document Verification Failed - Re-upload Required',
          message: `One or more documents failed lender verification / require correction${docNamesStr}${docCountStr}${reasonStr}. Please re-upload updated compliant copies in your Document Vault immediately.`,
          type: 'doc_revision',
          data: {
            leadId: lead._id,
            stage,
            url: '/client/documents',
            urgent: true,
            isRevision: true,
            rejectedDocsCount: docCount,
          },
        });
      } else {
        await createNotification({
          brokerageId,
          recipientId: clientId,
          recipientRole: 'client',
          title: 'Application Status Updated',
          message: `Your German mortgage application has progressed to ${getStageDisplayName(stage)}.`,
          type: 'stage_updated',
          data: { leadId: lead._id, stage, url: '/client/portal' },
        });
      }
    }

    // 2. Dispatch Non-blocking Background Asynchronous Email to Client
    if (lead.email) {
      (async () => {
        try {
          const brokerage = await Brokerage.findById(brokerageId);
          const rawAdvisorId = lead.assignedAdvisorId?._id || lead.assignedAdvisorId;
          let advisorUser = null;
          if (typeof lead.assignedAdvisorId === 'object' && lead.assignedAdvisorId?.name) {
            advisorUser = lead.assignedAdvisorId;
          } else if (rawAdvisorId) {
            advisorUser = await User.findById(rawAdvisorId).select('name email phone role');
          }

          if (isRegression) {
            await sendDocumentRevisionEmail({
              to: lead.email.toLowerCase().trim(),
              clientName: leadName || 'Valued Client',
              advisorName: advisorUser?.name || updatedByAdvisorName || 'Your Assigned Advisor',
              advisorEmail: advisorUser?.email || 'advisor@leadflow.de',
              brokerageName: brokerage?.name || 'LeadFlow Hypotheken GmbH',
              brokerageId,
              revisionReason: revisionReason || 'Document update requested by bank underwriter.',
              rejectedDocs,
            });
          } else {
            await sendStageMilestoneEmail({
              to: lead.email.toLowerCase().trim(),
              clientName: leadName || 'Valued Client',
              stage,
              previousStage,
              advisorName: advisorUser?.name || updatedByAdvisorName || 'Your Assigned Advisor',
              advisorEmail: advisorUser?.email || 'advisor@leadflow.de',
              advisorPhone: advisorUser?.phone || '',
              brokerageName: brokerage?.name || 'LeadFlow Hypotheken GmbH',
              brokerageId,
              loanAmount: lead.loanAmount,
              city: lead.city,
            });
          }
        } catch (emailErr) {
          console.error('[NotificationService Async Email Error]:', emailErr.message);
        }
      })();
    }

    // 3. Notify Assigned Advisor (In-App internal notification)
    // Exclude the advisor if they are the actor who initiated this stage update
    const assignedAdvisorId = lead.assignedAdvisorId?._id || lead.assignedAdvisorId;
    const actorId = updatedByAdvisorId ? String(updatedByAdvisorId) : null;
    const isActorAssignedAdvisor = assignedAdvisorId && actorId && String(assignedAdvisorId) === actorId;

    if (assignedAdvisorId && !isActorAssignedAdvisor) {
      await createNotification({
        brokerageId,
        recipientId: assignedAdvisorId,
        recipientRole: 'advisor',
        title: isRegression ? 'Client Case Reverted for Revision' : 'Client Stage Updated',
        message: isRegression
          ? `${leadName} reverted to Document Collection for lender revisions (${rejectedDocs.length} item(s) flagged)${updatedByAdvisorName ? ` by ${updatedByAdvisorName}` : ''}.`
          : `${leadName} moved to ${getStageDisplayName(stage)}${updatedByAdvisorName ? ` by ${updatedByAdvisorName}` : ''}.`,
        type: isRegression ? 'doc_revision' : 'stage_updated',
        data: { leadId: lead._id, stage, url: '/advisor/pipeline' },
      });
    }

    // 4. Notify Brokerage Admin (In-App internal notification)
    await createNotification({
      brokerageId,
      recipientRole: 'brokerage_admin',
      title: isRegression ? 'Client Case Reverted for Revision' : 'Client Stage Updated',
      message: isRegression
        ? `${leadName} reverted to Document Collection for lender revisions (${rejectedDocs.length} item(s) flagged)${updatedByAdvisorName ? ` by ${updatedByAdvisorName}` : ''}.`
        : `${leadName} moved to ${getStageDisplayName(stage)}${updatedByAdvisorName ? ` by ${updatedByAdvisorName}` : ''}.`,
      type: isRegression ? 'doc_revision' : 'stage_updated',
      data: { leadId: lead._id, stage, url: '/advisor/pipeline' },
    });

    // 5. Notify Platform Admin on major milestones (Completed/Won or Lost/Dropped)
    const isCompleted = stage === 'Loan Approved' || stage === 'Completed' || stage === 'Won';
    const isFailed = stage === 'Lost' || stage === 'Cancelled' || stage === 'Rejected';

    if (isCompleted || isFailed) {
      let bName = 'Brokerage';
      try {
        const brokerage = await Brokerage.findById(brokerageId).select('name');
        if (brokerage?.name) bName = brokerage.name;
      } catch (_) {}

      const amountStr = lead.loanAmount ? ` (€${Number(lead.loanAmount).toLocaleString()})` : '';

      if (isCompleted) {
        await createNotification({
          brokerageId,
          recipientRole: 'platform_admin',
          title: 'Loan Approved / Deal Completed',
          message: `${leadName}${amountStr} at ${bName} reached "${getStageDisplayName(stage)}".`,
          type: 'lead_completed',
          data: { leadId: lead._id, brokerageId, stage, url: '/platform-admin/analytics' },
        });
      } else if (isFailed) {
        await createNotification({
          brokerageId,
          recipientRole: 'platform_admin',
          title: 'Lead Closed / Deal Failed',
          message: `${leadName}${amountStr} at ${bName} was closed as "${getStageDisplayName(stage)}".`,
          type: 'lead_failed',
          data: { leadId: lead._id, brokerageId, stage, url: '/platform-admin/analytics' },
        });
      }
    }
  } catch (err) {
    console.error('[NotificationService] notifyStageUpdated error:', err.message);
  }
};

/**
 * 5. All Documents Uploaded Notification (18/18 Complete)
 * Dispatched ONLY when a client has successfully uploaded all 18 documents.
 */
export const notifyAllDocumentsUploaded = async ({ brokerageId, lead, clientName }) => {
  try {
    if (!brokerageId || !lead) return;

    const name = clientName || `${lead.firstName || 'Client'} ${lead.lastName || ''}`.trim();
    const assignedAdvisorId = lead.assignedAdvisorId?._id || lead.assignedAdvisorId;

    // Notify Assigned Advisor
    if (assignedAdvisorId) {
      await createNotification({
        brokerageId,
        recipientId: assignedAdvisorId,
        recipientRole: 'advisor',
        title: 'All Documents Uploaded',
        message: `${name} has uploaded all 18 documents. Ready for advisor compliance review.`,
        type: 'docs_complete',
        data: { leadId: lead._id || lead, url: '/advisor/documents' },
      });
    }

    // Notify Brokerage Admin
    await createNotification({
      brokerageId,
      recipientRole: 'brokerage_admin',
      title: 'Client Dossier Complete (18/18)',
      message: `${name} has completed uploading all 18 compliance documents.`,
      type: 'docs_complete',
      data: { leadId: lead._id || lead, url: '/advisor/documents' },
    });
  } catch (err) {
    console.error('[NotificationService] notifyAllDocumentsUploaded error:', err.message);
  }
};

/**
 * 6. Document Rejected Notification
 * Dispatched when a single document is rejected by advisor or underwriting.
 */
export const notifyDocumentRejected = async ({ brokerageId, doc, lead, rejectionReason, advisorName }) => {
  try {
    if (!brokerageId || !doc) return;
    let clientId = doc.clientId?._id || doc.clientId || lead?.clientId?._id || lead?.clientId;
    const docTitle = doc.title || doc.docType || 'Document';
    const reasonText = rejectionReason || doc.rejectionReason || 'Please provide an updated scan';

    if (!clientId && (lead?.email || doc.clientId?.email)) {
      try {
        const clientEmail = (lead?.email || doc.clientId?.email).toLowerCase().trim();
        const clientUser = await User.findOne({ email: clientEmail, brokerageId }).select('_id');
        if (clientUser) {
          clientId = clientUser._id;
        }
      } catch (findErr) {
        console.error('[NotificationService] Client lookup error in notifyDocumentRejected:', findErr.message);
      }
    }

    if (clientId) {
      await createNotification({
        brokerageId,
        recipientId: clientId,
        recipientRole: 'client',
        title: 'Document Verification Failed - Re-upload Required',
        message: `"${docTitle}" failed verification: ${reasonText}. Please upload an updated compliant version in your Document Vault.`,
        type: 'doc_revision',
        data: { leadId: lead?._id || doc.leadId, docId: doc._id, url: '/client/documents', urgent: true, isRevision: true },
      });
    }

    // Also send async email if recipient email exists
    const emailTo = lead?.email || doc.clientId?.email;
    if (emailTo) {
      (async () => {
        try {
          const brokerage = await Brokerage.findById(brokerageId);
          const rawAdvisorId = lead?.assignedAdvisorId?._id || lead?.assignedAdvisorId;
          let advisorUser = null;
          if (typeof lead?.assignedAdvisorId === 'object' && lead?.assignedAdvisorId?.name) {
            advisorUser = lead.assignedAdvisorId;
          } else if (rawAdvisorId) {
            advisorUser = await User.findById(rawAdvisorId).select('name email phone');
          }

          await sendDocumentRevisionEmail({
            to: emailTo.toLowerCase().trim(),
            clientName: lead ? `${lead.firstName} ${lead.lastName || ''}`.trim() : 'Valued Client',
            advisorName: advisorUser?.name || advisorName || 'Your Assigned Advisor',
            advisorEmail: advisorUser?.email || 'advisor@leadflow.de',
            brokerageName: brokerage?.name || 'LeadFlow Hypotheken GmbH',
            brokerageId,
            revisionReason: reasonText,
            rejectedDocs: [{ title: docTitle, docType: doc.docType, reason: reasonText }],
          });
        } catch (emailErr) {
          console.error('[Document Reject Async Email Error]:', emailErr.message);
        }
      })();
    }
  } catch (err) {
    console.error('[NotificationService] notifyDocumentRejected error:', err.message);
  }
};

/**
 * 7. Brokerage Registered Notification
 * Dispatched to Platform Admins when a new brokerage registers or is provisioned.
 */
export const notifyBrokerageRegistered = async ({ brokerage, adminUser }) => {
  try {
    if (!brokerage) return;
    const bName = brokerage.name || 'New Brokerage';
    const city = brokerage.city || 'Germany';
    const adminName = adminUser?.name || 'Admin';

    await createNotification({
      brokerageId: brokerage._id,
      recipientRole: 'platform_admin',
      title: 'New Brokerage Registered',
      message: `"${bName}" (${city}) was registered by ${adminName}.`,
      type: 'brokerage_registered',
      data: { brokerageId: brokerage._id, url: '/platform-admin/tenants' },
    });
  } catch (err) {
    console.error('[NotificationService] notifyBrokerageRegistered error:', err.message);
  }
};
