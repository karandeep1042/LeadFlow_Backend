import Document from '../models/Document.js';
import Brokerage from '../models/Brokerage.js';
import Lead from '../models/Lead.js';
import { processDocumentVerificationAsync } from '../services/documentWorker.js';
import { emitToBrokerage, emitToUser } from '../utils/socket.js';
import { calculateLeadDocsSummary } from './leadController.js';
import { notifyAllDocumentsUploaded, notifyDocumentRejected } from '../services/notificationService.js';
import cacheService from '../services/cacheService.js';
import { uploadBufferToCloudinary, saveBufferLocally } from '../utils/cloudinary.js';

export const invalidateDocumentCaches = async (brokerageId, leadId = null, clientId = null) => {
  if (!brokerageId) return;
  try {
    const promises = [
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'docs', '*')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'leads', '*')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'client', '*')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'client:portal', '*')),
      cacheService.del(cacheService.generateKey(brokerageId, 'dash', 'stats')),
    ];
    await Promise.all(promises);
  } catch (err) {
    console.warn('[Cache] Error invalidating document caches:', err.message);
  }
};

export const getDocuments = async (req, res) => {
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
      'docs',
      `${req.user?.role}:${req.user?._id}:${req.params.caseId || ''}:${JSON.stringify(sortedQuery)}`
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const filter = { ...req.tenantFilter };
    const { status, category, search, advisorId, leadId, caseId } = req.query;

    if (req.user.role === 'client') {
      filter.clientId = req.user._id;
    } else if (req.user.role === 'advisor') {
      const assignedLeads = await Lead.find({
        brokerageId: req.user.brokerageId,
        assignedAdvisorId: req.user._id,
      }).select('_id clientId');

      const assignedLeadIds = assignedLeads.map((l) => l._id);
      const assignedClientIds = assignedLeads.filter((l) => l.clientId).map((l) => l.clientId);

      filter.$or = [
        { leadId: { $in: assignedLeadIds } },
        { clientId: { $in: assignedClientIds } },
      ];
    } else if (advisorId && advisorId !== 'all') {
      const advisorLeads = await Lead.find({
        brokerageId: req.user.brokerageId,
        assignedAdvisorId: advisorId,
      }).select('_id clientId');

      const advisorLeadIds = advisorLeads.map((l) => l._id);
      const advisorClientIds = advisorLeads.filter((l) => l.clientId).map((l) => l.clientId);

      filter.$or = [
        { leadId: { $in: advisorLeadIds } },
        { clientId: { $in: advisorClientIds } },
      ];
    }

    const targetCaseId = req.params.caseId || caseId;
    const targetLeadId = req.query.leadId;
    const targetClientId = req.query.clientId;

    if (targetLeadId || targetClientId || (targetCaseId && targetCaseId !== 'current' && targetCaseId !== 'all')) {
      const orList = [];
      if (targetLeadId) orList.push({ leadId: targetLeadId });
      if (targetClientId) orList.push({ clientId: targetClientId });
      if (targetCaseId && targetCaseId !== 'current' && targetCaseId !== 'all') {
        orList.push({ leadId: targetCaseId }, { clientId: targetCaseId });
      }
      filter.$or = orList;
    }

    if (status && status !== 'all') filter.status = status;
    if (category && category !== 'all') filter.category = category;

    if (search && search.trim()) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { title: { $regex: search.trim(), $options: 'i' } },
          { fileName: { $regex: search.trim(), $options: 'i' } },
          { docType: { $regex: search.trim(), $options: 'i' } },
        ],
      });
    }

    const documents = await Document.find(filter)
      .populate('clientId', 'name email phone status')
      .populate({
        path: 'leadId',
        select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
        populate: { path: 'assignedAdvisorId', select: 'name email' },
      })
      .sort({ createdAt: -1 });

    const responsePayload = { success: true, data: { documents, total: documents.length } };
    cacheService.set(cacheKey, responsePayload, 300).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadDocument = async (req, res) => {
  try {
    const { docType, category, title, fileName, fileSize, leadId } = req.body;
    const clientId = req.user.role === 'client' ? req.user._id : req.body.clientId;

    if (!docType) {
      return res.status(400).json({ success: false, message: 'Document type is required' });
    }

    let associatedLeadId = leadId || null;
    let associatedLead = null;
    if (associatedLeadId) {
      associatedLead = await Lead.findById(associatedLeadId);
    } else if (clientId || req.user.role === 'client') {
      associatedLead = await Lead.findOne({
        brokerageId: req.user.brokerageId,
        $or: [
          ...(clientId ? [{ clientId }] : []),
          ...(req.user.email ? [{ email: req.user.email.toLowerCase() }] : []),
        ],
      }).sort({ isDeclined: 1, isArchived: 1, updatedAt: -1 });
      if (associatedLead) associatedLeadId = associatedLead._id;
    }

    const effectiveClientId = clientId || req.user._id;

    // Client-side Vault Locking Guardrails
    if (req.user.role === 'client' && associatedLead) {
      if (associatedLead.isDeclined) {
        return res.status(403).json({
          success: false,
          message: 'Document vault is in read-only mode because this financing case has concluded.',
        });
      }

      if (associatedLead.isArchived) {
        return res.status(403).json({
          success: false,
          message: 'Document vault is closed because this mortgage has been finalized and disbursed.',
        });
      }

      const isStageLocked = ['Bank Submission', 'Won', 'Lost', 'Approved', 'Closed Won'].includes(associatedLead.stage);
      if (isStageLocked) {
        const existingDoc = await Document.findOne({
          brokerageId: req.user.brokerageId,
          $or: [
            { clientId: effectiveClientId, docType },
            ...(associatedLeadId ? [{ leadId: associatedLeadId, docType }] : []),
          ],
        });

        if (!existingDoc || existingDoc.status !== 'rejected') {
          return res.status(403).json({
            success: false,
            message: 'Document vault is locked during lender underwriting. Only documents explicitly requested for revision by your advisor can be uploaded or replaced.',
          });
        }
      }
    }

    const effectiveFileName = req.file?.originalname || fileName || `${docType}.pdf`;
    let effectiveFileSize = req.file?.size || Number(fileSize) || 1024 * 1024;
    const effectiveMimeType = req.file?.mimetype || req.body.mimeType || 'application/pdf';
    let effectiveFileUrl = '';
    let cloudinaryPublicId = null;

    if (req.file && req.file.buffer) {
      try {
        const cleanName = effectiveFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uploadResult = await uploadBufferToCloudinary(req.file.buffer, {
          folder: `leadflow/documents/${effectiveClientId}`,
          filename: `${docType}_${Date.now()}_${cleanName}`,
          resource_type: 'auto',
        });

        effectiveFileUrl = uploadResult.secure_url || uploadResult.url;
        cloudinaryPublicId = uploadResult.public_id || null;
        if (uploadResult.bytes) {
          effectiveFileSize = uploadResult.bytes;
        }
      } catch (cErr) {
        console.error('[Upload Processing Failed, attempting local storage]:', cErr.message);
        try {
          const cleanName = effectiveFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const localResult = await saveBufferLocally(req.file.buffer, {
            filename: `${docType}_${Date.now()}_${cleanName}`,
          });
          effectiveFileUrl = localResult.secure_url || localResult.url;
          cloudinaryPublicId = localResult.public_id || null;
        } catch (localErr) {
          console.error('[Local Storage Emergency Fallback Failed]:', localErr.message);
        }
      }
    } else if (req.body.fileUrl) {
      effectiveFileUrl = req.body.fileUrl;
    }

    if (!effectiveFileUrl) {
      return res.status(400).json({
        success: false,
        message: 'No document file provided. Please attach a valid file to upload.',
      });
    }

    // Upsert: find an existing doc for this client+docType and update it in place,
    // or create a new one if none exists. This guarantees exactly ONE document record
    // per docType per client — so replacing a verified doc resets the SAME record
    // rather than spawning a duplicate that inflates the verified counter.
    const upsertedDoc = await Document.findOneAndUpdate(
      {
        brokerageId: req.user.brokerageId,
        docType,
        $or: [
          { clientId: effectiveClientId },
          ...(associatedLeadId ? [{ leadId: associatedLeadId }] : []),
        ],
      },
      {
        $set: {
          clientId: effectiveClientId,
          leadId: associatedLeadId,
          category: category || 'personal',
          title: title || docType.replace(/_/g, ' ').toUpperCase(),
          fileName: effectiveFileName,
          fileUrl: effectiveFileUrl,
          fileSize: effectiveFileSize,
          mimeType: effectiveMimeType,
          cloudinaryPublicId: cloudinaryPublicId,
          status: 'processing',
          advisorApproved: false,
          rejectionReason: null,
          verifiedAt: null,
          notes: '',
        },
      },
      {
        new: true,       // return the updated document
        upsert: true,    // create if not found
        setDefaultsOnInsert: true,
      }
    );

    const populatedDoc = await Document.findById(upsertedDoc._id)
      .populate('clientId', 'name email phone status')
      .populate({
        path: 'leadId',
        select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
        populate: { path: 'assignedAdvisorId', select: 'name email' },
      });

    processDocumentVerificationAsync(upsertedDoc._id, req.user.brokerageId);

    if (req.user.brokerageId) {
      emitToBrokerage(req.user.brokerageId, 'document:created', populatedDoc);
    }

    // Check if client has reached 18/18 documents uploaded
    if (associatedLead) {
      (async () => {
        try {
          const docsSummary = await calculateLeadDocsSummary(associatedLead._id, associatedLead.clientId, req.user.brokerageId);
          if (docsSummary.uploadedCount >= 18) {
            notifyAllDocumentsUploaded({
              brokerageId: req.user.brokerageId,
              lead: associatedLead,
              clientName: req.user.name,
            });
          }
        } catch (sumErr) {
          console.error('[Document Upload 18/18 Summary Check Error]:', sumErr.message);
        }
      })();
    }

    await invalidateDocumentCaches(req.user.brokerageId, associatedLead?._id, effectiveClientId);

    return res.status(201).json({ success: true, data: populatedDoc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveDocument = async (req, res) => {
  try {
    const { docId } = req.params;
    const { notes } = req.body;

    const doc = await Document.findOne({ _id: docId, ...req.tenantFilter });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    let associatedLead = null;
    if (doc.leadId) {
      associatedLead = await Lead.findById(doc.leadId);
    } else if (doc.clientId) {
      associatedLead = await Lead.findOne({ clientId: doc.clientId, brokerageId: doc.brokerageId });
    }

    if (associatedLead) {
      if (req.user.role === 'advisor' && associatedLead.assignedAdvisorId && String(associatedLead.assignedAdvisorId) !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are only authorized to audit documents for your assigned leads.',
        });
      }

      if (associatedLead.stage !== 'Document Collection') {
        return res.status(400).json({
          success: false,
          message: `Document Audit Locked: Documents cannot be verified while the financing case is in "${associatedLead.stage}". Document audit actions are only active during "Document Collection".`,
        });
      }
    }

    doc.status = 'verified';
    doc.advisorApproved = true;
    doc.rejectionReason = null;
    doc.notes = notes || `Verified by ${req.user.name} for German bank submission.`;
    doc.verifiedAt = new Date();
    await doc.save();

    await Brokerage.findByIdAndUpdate(doc.brokerageId, { $inc: { 'metrics.documentsAcceptedCount': 1 } });

    const updatedDoc = await Document.findById(doc._id)
      .populate('clientId', 'name email phone status')
      .populate({
        path: 'leadId',
        select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
        populate: { path: 'assignedAdvisorId', select: 'name email' },
      });

    if (doc.brokerageId) emitToBrokerage(doc.brokerageId, 'document:updated', updatedDoc);
    if (doc.clientId?._id) emitToUser(doc.clientId._id, 'document:updated', updatedDoc);

    if (doc.leadId) {
      await Lead.findByIdAndUpdate(doc.leadId, {
        $push: {
          notesList: {
            author: req.user.name,
            text: `[Document Verified]: Approved "${doc.title}" for bank dossier submission.`,
            createdAt: new Date(),
          },
        },
      });

      const populatedLead = await Lead.findById(doc.leadId)
        .populate('assignedAdvisorId', 'name email phone role')
        .populate('clientId', 'name email phone role status')
        .populate('duplicateOf', 'firstName lastName email stage');
      if (populatedLead) {
        const docsSummary = await calculateLeadDocsSummary(populatedLead._id, populatedLead.clientId, populatedLead.brokerageId);
        const leadObj = populatedLead.toObject();
        leadObj.docsSummary = docsSummary;
        emitToBrokerage(doc.brokerageId, 'lead:updated', leadObj);
      }
    }

    await invalidateDocumentCaches(doc.brokerageId, doc.leadId, doc.clientId);

    return res.status(200).json({ success: true, data: updatedDoc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectDocument = async (req, res) => {
  try {
    const { docId } = req.params;
    const { reason, notes } = req.body;

    const doc = await Document.findOne({ _id: docId, ...req.tenantFilter });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    let associatedLead = null;
    if (doc.leadId) {
      associatedLead = await Lead.findById(doc.leadId);
    } else if (doc.clientId) {
      associatedLead = await Lead.findOne({ clientId: doc.clientId, brokerageId: doc.brokerageId });
    }

    if (associatedLead) {
      if (req.user.role === 'advisor' && associatedLead.assignedAdvisorId && String(associatedLead.assignedAdvisorId) !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are only authorized to review documents for your assigned leads.',
        });
      }

      if (associatedLead.stage !== 'Document Collection') {
        return res.status(400).json({
          success: false,
          message: `Document Audit Locked: Documents cannot be rejected while the financing case is in "${associatedLead.stage}". Document audit actions are only active during "Document Collection". Revert the case to Document Collection to request lender revisions.`,
        });
      }
    }

    const rejectionText = reason || 'Document rejected by advisor. Please re-upload a compliant version.';
    doc.status = 'rejected';
    doc.advisorApproved = false;
    doc.rejectionReason = rejectionText;
    if (notes) doc.notes = notes;
    await doc.save();

    await Brokerage.findByIdAndUpdate(doc.brokerageId, { $inc: { 'metrics.documentsRejectedCount': 1 } });

    const updatedDoc = await Document.findById(doc._id)
      .populate('clientId', 'name email phone status')
      .populate({
        path: 'leadId',
        select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
        populate: { path: 'assignedAdvisorId', select: 'name email' },
      });

    if (doc.brokerageId) emitToBrokerage(doc.brokerageId, 'document:updated', updatedDoc);
    if (doc.clientId?._id) emitToUser(doc.clientId._id, 'document:updated', updatedDoc);

    if (doc.leadId) {
      await Lead.findByIdAndUpdate(doc.leadId, {
        $push: {
          notesList: {
            author: req.user.name,
            text: `[Document Revision Requested]: Rejected "${doc.title}". Reason: ${rejectionText}`,
            createdAt: new Date(),
          },
        },
      });

      const populatedLead = await Lead.findById(doc.leadId)
        .populate('assignedAdvisorId', 'name email phone role')
        .populate('clientId', 'name email phone role status')
        .populate('duplicateOf', 'firstName lastName email stage');
      if (populatedLead) {
        const docsSummary = await calculateLeadDocsSummary(populatedLead._id, populatedLead.clientId, populatedLead.brokerageId);
        const leadObj = populatedLead.toObject();
        leadObj.docsSummary = docsSummary;
        emitToBrokerage(doc.brokerageId, 'lead:updated', leadObj);
      }
    }

    // Trigger in-app notification and async email to client about document rejection
    notifyDocumentRejected({
      brokerageId: doc.brokerageId,
      doc: updatedDoc,
      lead: associatedLead,
      rejectionReason: rejectionText,
      advisorName: req.user.name,
    });

    await invalidateDocumentCaches(doc.brokerageId, doc.leadId, doc.clientId);

    return res.status(200).json({ success: true, data: updatedDoc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reverifyDocument = async (req, res) => {
  try {
    const { docId } = req.params;
    const doc = await Document.findOne({ _id: docId, ...req.tenantFilter });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    let associatedLead = null;
    if (doc.leadId) {
      associatedLead = await Lead.findById(doc.leadId);
    } else if (doc.clientId) {
      associatedLead = await Lead.findOne({ clientId: doc.clientId, brokerageId: doc.brokerageId });
    }

    if (associatedLead && associatedLead.stage !== 'Document Collection') {
      return res.status(400).json({
        success: false,
        message: `Document Audit Locked: Re-verification is only permitted while the financing case is in "Document Collection" (Current Stage: ${associatedLead.stage}).`,
      });
    }

    doc.status = 'processing';
    doc.advisorApproved = false;
    doc.rejectionReason = null;
    doc.notes = 'Re-verification in progress...';
    await doc.save();

    const updatedDoc = await Document.findById(doc._id)
      .populate('clientId', 'name email phone status')
      .populate({
        path: 'leadId',
        select: 'firstName lastName email phone stage loanAmount city visaType assignedAdvisorId employmentType monthlyNetIncome',
        populate: { path: 'assignedAdvisorId', select: 'name email' },
      });

    if (doc.brokerageId) emitToBrokerage(doc.brokerageId, 'document:updated', updatedDoc);
    processDocumentVerificationAsync(doc._id, req.user.brokerageId);

    await invalidateDocumentCaches(doc.brokerageId, doc.leadId, doc.clientId);

    return res.status(200).json({ success: true, data: updatedDoc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
