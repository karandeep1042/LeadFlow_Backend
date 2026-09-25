import Document from '../models/Document.js';
import Brokerage from '../models/Brokerage.js';

export const getDocuments = async (req, res) => {
  try {
    const filter = { ...req.tenantFilter };

    // If client, only view own documents
    if (req.user.role === 'client') {
      filter.clientId = req.user._id;
    } else {
      const caseId = req.params.caseId || req.query.caseId || req.query.clientId;
      if (caseId && caseId !== 'current') {
        filter.clientId = caseId;
      }
    }

    const documents = await Document.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: { documents } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadDocument = async (req, res) => {
  try {
    const { docType, category, title, fileName, fileSize } = req.body;
    const clientId = req.user.role === 'client' ? req.user._id : req.body.clientId;

    if (!docType) {
      return res.status(400).json({ success: false, message: 'Document type is required' });
    }

    const newDoc = await Document.create({
      brokerageId: req.user.brokerageId,
      clientId,
      docType,
      category: category || 'personal',
      title: title || docType.replace(/_/g, ' ').toUpperCase(),
      fileName: fileName || `${docType}.pdf`,
      fileUrl: `https://storage.leadflow.de/docs/${clientId}/${docType}.pdf`,
      fileSize: fileSize || 1024 * 1024,
      status: 'processing', // Simulated async background verification
      advisorApproved: false,
    });

    return res.status(201).json({ success: true, data: newDoc });
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

    doc.status = 'verified';
    doc.advisorApproved = true;
    doc.rejectionReason = null;
    doc.notes = notes || '';
    doc.verifiedAt = new Date();
    await doc.save();

    await Brokerage.findByIdAndUpdate(doc.brokerageId, { $inc: { 'metrics.documentsAcceptedCount': 1 } });

    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectDocument = async (req, res) => {
  try {
    const { docId } = req.params;
    const { reason } = req.body;

    const doc = await Document.findOne({ _id: docId, ...req.tenantFilter });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    doc.status = 'rejected';
    doc.advisorApproved = false;
    doc.rejectionReason = reason || 'Document rejected by advisor. Please re-upload.';
    await doc.save();

    await Brokerage.findByIdAndUpdate(doc.brokerageId, { $inc: { 'metrics.documentsRejectedCount': 1 } });

    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
