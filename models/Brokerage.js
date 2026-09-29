import mongoose from 'mongoose';

const BrokerageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Brokerage name is required'],
      trim: true,
    },
    subdomain: {
      type: String,
      trim: true,
      lowercase: true,
    },
    city: {
      type: String,
      default: 'Berlin',
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },
    banReason: {
      type: String,
      default: '',
    },
    suspendedAt: {
      type: Date,
      default: null,
    },
    primaryAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metrics: {
      totalLeadsIngested: { type: Number, default: 0 },
      acquiredClientsCount: { type: Number, default: 0 },
      documentsAcceptedCount: { type: Number, default: 0 },
      documentsRejectedCount: { type: Number, default: 0 },
      totalMortgageVolumeEur: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Brokerage', BrokerageSchema);
