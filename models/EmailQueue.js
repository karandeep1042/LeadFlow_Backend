import mongoose from 'mongoose';

const emailQueueSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: false,
      default: null,
      index: true,
    },
    to: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    html: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      default: '',
    },
    from: {
      type: String,
      default: null,
    },
    templateType: {
      type: String,
      default: 'general',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastError: {
      type: String,
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for high-performance worker polling
emailQueueSchema.index({ status: 1, nextAttemptAt: 1 });

const EmailQueue = mongoose.model('EmailQueue', emailQueueSchema);

export default EmailQueue;
