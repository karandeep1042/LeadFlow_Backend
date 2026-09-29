import mongoose from 'mongoose';

const EmailVerificationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      index: true,
    },
    verificationCode: {
      type: String,
      required: [true, 'Verification code is required'],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: '15m' }, // Auto-remove from collection 15 mins after expiresAt
    },
  },
  { timestamps: true }
);

export default mongoose.model('EmailVerification', EmailVerificationSchema);
