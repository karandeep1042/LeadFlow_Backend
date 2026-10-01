import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: true,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    docType: {
      type: String,
      required: true, // e.g. 'passport', 'payslip_1', 'schufa', 'bank_statement', etc.
    },
    category: {
      type: String,
      enum: ['personal', 'income', 'financial', 'property', 'other'],
      default: 'personal',
    },
    title: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: 'application/pdf' },
    cloudinaryPublicId: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'processing', 'verified', 'rejected'],
      default: 'processing',
      index: true,
    },
    advisorApproved: { type: Boolean, default: false },
    rejectionReason: { type: String, default: null },
    notes: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Document', DocumentSchema);
