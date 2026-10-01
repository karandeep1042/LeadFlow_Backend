import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const MembershipSchema = new mongoose.Schema(
  {
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ['platform_admin', 'brokerage_admin', 'advisor', 'client'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'invited'],
      default: 'active',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // Do not include in queries by default
    },
    role: {
      type: String,
      enum: ['platform_admin', 'brokerage_admin', 'advisor', 'client'],
      required: true,
      default: 'advisor',
      index: true,
    },
    brokerageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brokerage',
      default: null,
      index: true,
    },
    memberships: {
      type: [MembershipSchema],
      default: [],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'invited'],
      default: 'active',
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    isTemporaryPassword: {
      type: Boolean,
      default: false,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
    refreshToken: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre('save', async function () {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Ensure memberships array is synchronized with root role/brokerageId if memberships is empty
  if (this.memberships.length === 0 && (this.role || this.brokerageId)) {
    this.memberships.push({
      brokerageId: this.brokerageId || null,
      role: this.role || 'advisor',
      status: this.status || 'active',
      joinedAt: this.createdAt || new Date(),
    });
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Retrieve all populated active workspaces
UserSchema.methods.getWorkspaces = async function () {
  if (mongoose.connection.readyState === 1) {
    try {
      await this.populate('memberships.brokerageId', 'name city status subdomain');
    } catch (e) {
      // Fallback if populate fails
    }
  }

  let membershipsList = this.memberships || [];
  if (membershipsList.length === 0 && (this.role || this.brokerageId)) {
    membershipsList = [
      {
        _id: this._id,
        brokerageId: this.brokerageId,
        role: this.role,
        status: this.status || 'active',
        joinedAt: this.createdAt || new Date(),
      },
    ];
  }

  const workspaces = [];
  for (const m of membershipsList) {
    if (m.status === 'suspended') continue;

    if (m.role === 'platform_admin') {
      workspaces.push({
        membershipId: m._id?.toString(),
        brokerageId: null,
        brokerageName: 'Global SaaS Platform',
        city: 'Global',
        subdomain: 'admin',
        role: 'platform_admin',
        status: m.status,
      });
      continue;
    }

    const b = m.brokerageId;
    if (b && typeof b === 'object' && b.status !== 'suspended') {
      workspaces.push({
        membershipId: m._id?.toString(),
        brokerageId: b._id.toString(),
        brokerageName: b.name,
        city: b.city || 'Berlin',
        subdomain: b.subdomain || '',
        role: m.role,
        status: m.status,
      });
    } else if (b && typeof b === 'string') {
      workspaces.push({
        membershipId: m._id?.toString(),
        brokerageId: b.toString(),
        brokerageName: 'Brokerage Workspace',
        city: 'Berlin',
        subdomain: '',
        role: m.role,
        status: m.status,
      });
    }
  }

  return workspaces;
};

export default mongoose.model('User', UserSchema);
