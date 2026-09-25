import mongoose from 'mongoose';

const LeadSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: true,
      index: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true, default: '' },
    loanAmount: { type: Number, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    city: { type: String, default: 'Berlin' },
    visaType: { type: String, default: 'EU Blue Card' },
    employmentType: { type: String, default: 'Employed' },
    monthlyNetIncome: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    notesList: [
      {
        author: String,
        text: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    stage: {
      type: String,
      enum: ['New', 'Contacted', 'Qualified', 'Document Collection', 'Bank Submission', 'Won', 'Lost'],
      default: 'New',
      index: true,
    },
    assignedAdvisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    isDuplicate: { type: Boolean, default: false },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    duplicateResolved: { type: Boolean, default: false },
    isConverted: { type: Boolean, default: false },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'IngestionSource', default: null },
    sourceName: { type: String, default: 'Manual Entry' },
  },
  { timestamps: true }
);

export default mongoose.model('Lead', LeadSchema);
