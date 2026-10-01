import Document from '../models/Document.js';
import Brokerage from '../models/Brokerage.js';
import Lead from '../models/Lead.js';
import { emitToBrokerage, emitToUser } from '../utils/socket.js';
import { calculateLeadDocsSummary } from '../controllers/leadController.js';
import { invalidateDocumentCaches } from '../controllers/documentController.js';

// Realistic German Mortgage Document Rejection Simulation Reasons
const REJECTION_REASONS = [
  'Document scan is blurry or unreadable. Please upload a high-resolution PDF or scan.',
  'SCHUFA Bonitätsauskunft is older than 60 days. German lenders require a current credit certificate.',
  'Uploaded payslip (Gehaltsabrechnung) is missing the net income calculation breakdown (Nettolohn).',
  'Aufenthaltstitel / Passport scan is missing the reverse side / supplement sheet (Zusatzblatt).',
  'Bank statement does not show official account holder name matching the mortgage application.',
];

/**
 * Asynchronous Background Worker for Document Verification Simulation
 *
 * Simulates async OCR extraction, data integrity checks, and German bank compliance audits
 * with a realistic 3.5s - 4.5s processing delay. Emits WebSocket updates live.
 *
 * @param {string|import('mongoose').Types.ObjectId} docId
 * @param {string|import('mongoose').Types.ObjectId} brokerageId
 */
export const processDocumentVerificationAsync = async (docId, brokerageId) => {
  // Use non-blocking setTimeout to simulate background worker queue processing
  const delayMs = 3500 + Math.floor(Math.random() * 1500); // 3.5s to 5.0s

  setTimeout(async () => {
    try {
      const doc = await Document.findById(docId)
        .populate('clientId', 'name email phone status')
        .populate({
          path: 'leadId',
          select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
          populate: { path: 'assignedAdvisorId', select: 'name email' },
        });

      if (!doc || doc.status !== 'processing') {
        return; // Document was already audited or deleted
      }

      // Capture whether this document was previously verified before this upload cycle.
      // With the upsert pattern, a replaced document is reset to status:'processing' and
      // verifiedAt:null, so wasVerifiedBefore will be false for a fresh replacement.
      // This prevents double-incrementing the brokerage accepted-docs counter.
      const wasVerifiedBefore = !!doc.verifiedAt;

      // 12% probability of background compliance rejection for simulation realism
      const isRejected = Math.random() < 0.12;

      if (isRejected) {
        const randomReason = REJECTION_REASONS[Math.floor(Math.random() * REJECTION_REASONS.length)];
        doc.status = 'rejected';
        doc.advisorApproved = false;
        doc.rejectionReason = randomReason;
        doc.notes = `[Automated Check]: Failed compliance scan. ${randomReason}`;
        await doc.save();

        if (brokerageId) {
          // Only increment brokerage rejection counter if the doc wasn't already rejected
          // (i.e., this is truly a new rejection, not a re-rejection of the same record)
          await Brokerage.findByIdAndUpdate(brokerageId, {
            $inc: { 'metrics.documentsRejectedCount': 1 },
          });
        }
      } else {
        // Successful background verification
        doc.status = 'verified';
        doc.advisorApproved = true;
        doc.rejectionReason = null;
        doc.verifiedAt = new Date();
        doc.notes = `[Automated Check]: Background compliance check passed. Ready for German lender submission (Bankanfrage).`;
        await doc.save();

        if (brokerageId && !wasVerifiedBefore) {
          await Brokerage.findByIdAndUpdate(brokerageId, {
            $inc: { 'metrics.documentsAcceptedCount': 1 },
          });
        }
      }

      // Populate fresh data for live UI broadcast
      const updatedDoc = await Document.findById(doc._id)
        .populate('clientId', 'name email phone status')
        .populate({
          path: 'leadId',
          select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
          populate: { path: 'assignedAdvisorId', select: 'name email' },
        });

      // Emit real-time WebSocket update to the brokerage room (both Advisor & Client views receive this)
      if (brokerageId) {
        emitToBrokerage(brokerageId, 'document:status_updated', updatedDoc);
        emitToBrokerage(brokerageId, 'document:updated', updatedDoc);
      }

      // Also notify individual client socket room if available
      if (doc.clientId?._id) {
        emitToUser(doc.clientId._id, 'document:updated', updatedDoc);
      }

      // Broadcast updated lead docsSummary if attached to a lead
      const targetLeadId = doc.leadId?._id || doc.leadId;
      if (targetLeadId && brokerageId) {
        const populatedLead = await Lead.findById(targetLeadId)
          .populate('assignedAdvisorId', 'name email phone role')
          .populate('clientId', 'name email phone role status')
          .populate('duplicateOf', 'firstName lastName email stage');
        if (populatedLead) {
          const docsSummary = await calculateLeadDocsSummary(populatedLead._id, populatedLead.clientId, populatedLead.brokerageId);
          const leadObj = populatedLead.toObject();
          leadObj.docsSummary = docsSummary;
          emitToBrokerage(brokerageId, 'lead:updated', leadObj);
        }
      }

      // Invalidate all related Redis caches (documents, leads, client portal, and dashboard stats)
      await invalidateDocumentCaches(
        brokerageId,
        doc.leadId?._id || doc.leadId,
        doc.clientId?._id || doc.clientId
      );

      console.log(`[Document Worker]: Async verification completed for doc ${doc._id} (${doc.title}) -> Result: ${doc.status.toUpperCase()}`);
    } catch (err) {
      console.error(`[Document Worker Error] Failed processing doc ${docId}:`, err.message);
    }
  }, delayMs);
};
