import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      required: false,
      default: null,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null, // null indicates broadcast to a role or all users in brokerage/platform
    },
    recipientRole: {
      type: String,
      enum: ['advisor', 'brokerage_admin', 'client', 'platform_admin', 'all'],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        'lead_ingested',
        'task_assigned',
        'task_completed',
        'docs_complete',
        'stage_updated',
        'doc_revision',
        'brokerage_registered',
        'lead_completed',
        'lead_failed',
        'platform_alert',
        'general',
      ],
      required: true,
      index: true,
    },
    data: {
      leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
      brokerageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brokerage' },
      taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
      docId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
      stage: { type: String },
      url: { type: String },
      metadata: { type: mongoose.Schema.Types.Mixed },
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast targeted notifications lookup
notificationSchema.index({ brokerageId: 1, recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ brokerageId: 1, recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;

