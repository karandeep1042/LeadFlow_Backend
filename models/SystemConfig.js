import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: ['database', 'redis', 'smtp'],
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastStatus: {
      type: String,
      enum: ['operational', 'connected', 'fallback', 'degraded', 'error'],
      default: 'operational',
    },
    lastMessage: {
      type: String,
      default: '',
    },
    lastTestedAt: {
      type: Date,
      default: Date.now,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);

export default SystemConfig;
