import mongoose from 'mongoose';

const StageTriggerSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: true,
      index: true,
    },
    stage: {
      type: String,
      enum: ['New', 'Contacted', 'Qualified', 'Document Collection', 'Bank Submission', 'Won', 'Lost'],
      required: true,
    },
    emailTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      default: null,
    },
    taskTitle: { type: String, default: '' },
    taskDueHours: { type: Number, default: 2 },
    taskPriority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('StageTrigger', StageTriggerSchema);
