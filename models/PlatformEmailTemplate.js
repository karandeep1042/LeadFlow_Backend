import mongoose from 'mongoose';

const PlatformEmailTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['Onboarding', 'Account Status', 'Authentication & Security'],
      default: 'Onboarding',
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    availableTags: {
      type: [String],
      default: [],
    },
    defaultSubject: {
      type: String,
      required: true,
    },
    defaultBody: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('PlatformEmailTemplate', PlatformEmailTemplateSchema);
