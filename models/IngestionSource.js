import mongoose from 'mongoose';

const IngestionSourceSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    provider: {
      type: String,
      enum: ['typeform', 'calendly', 'meta', 'custom', 'zapier'],
      default: 'custom',
    },
    apiKeyPrefix: { type: String, default: '' },
    apiKeyHash: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    fieldMapping: {
      firstName: { type: String, default: 'first_name' },
      lastName: { type: String, default: 'last_name' },
      email: { type: String, default: 'email' },
      phone: { type: String, default: 'phone' },
      loanAmount: { type: String, default: 'loan_amount' },
      notes: { type: String, default: 'notes' },
    },
    lastPayloadReceivedAt: { type: Date, default: null },
    totalLeadsIngested: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('IngestionSource', IngestionSourceSchema);
