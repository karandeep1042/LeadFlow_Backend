import mongoose from 'mongoose';

const EmailTemplateSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('EmailTemplate', EmailTemplateSchema);
