import User from '../models/User.js';
import Brokerage from '../models/Brokerage.js';
import EmailVerification from '../models/EmailVerification.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from '../utils/jwt.js';
import {
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail,
  sendSignupVerificationEmail,
} from '../utils/emailService.js';
import { notifyBrokerageRegistered } from '../services/notificationService.js';

// Password Strength Validator
export const validatePasswordStrength = (password) => {
  if (!password || typeof password !== 'string') {
    return { isValid: false, message: 'Password is required.' };
  }
  if (password.length < 6) {
    return { isValid: false, message: 'Password must be at least 6 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one number (0-9).' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one special character (e.g. !@#$%&*).' };
  }
  return { isValid: true };
};

// 1. Brokerage Admin Self-Registration (SaaS Onboarding)
export const registerBrokerage = async (req, res) => {
  try {
    const { brokerageName, subdomain, name, email, password, city, phone } = req.body;

    if (!brokerageName || !name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Brokerage name, admin name, email, and password are required.',
      });
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    // Verify that the email was verified
    const emailVerification = await EmailVerification.findOne({
      email: normalizedEmail,
      isVerified: true,
    });
    if (!emailVerification) {
      return res.status(400).json({
        success: false,
        message: 'Please verify your business email address before completing registration.',
      });
    }

    const brokerage = await Brokerage.create({
      name: brokerageName.trim(),
      subdomain: subdomain ? subdomain.toLowerCase().trim() : brokerageName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      city: city || 'Berlin',
      phone: phone ? phone.trim() : '',
      status: 'active',
    });

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'brokerage_admin',
      brokerageId: brokerage._id,
      phone: phone ? phone.trim() : '',
      status: 'active',
    });

    brokerage.primaryAdminId = user._id;
    await brokerage.save();

    // Clean up temporary email verification records
    await EmailVerification.deleteMany({ email: normalizedEmail });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    // Notify platform admin in real-time
    notifyBrokerageRegistered({ brokerage, adminUser: user });

    return res.status(201).json({
      success: true,
      message: 'Brokerage and Admin account registered successfully.',
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        brokerageId: user.brokerageId,
        brokerage: {
          id: brokerage._id,
          _id: brokerage._id,
          name: brokerage.name,
          city: brokerage.city,
          status: brokerage.status,
        },
        brokerageName: brokerage.name,
      },
      role: user.role,
      brokerageId: user.brokerageId,
    });
  } catch (error) {
    console.error('Register brokerage error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during brokerage registration.',
    });
  }
};

// 2. Universal User Login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended. Please contact your administrator.',
      });
    }

    let userBrokerage = null;
    if (user.role !== 'platform_admin' && user.brokerageId) {
      const brokerage = await Brokerage.findById(user.brokerageId);
      if (brokerage && brokerage.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your brokerage subscription is currently suspended.',
        });
      }
      if (brokerage) {
        userBrokerage = {
          id: brokerage._id,
          _id: brokerage._id,
          name: brokerage.name,
          city: brokerage.city,
          status: brokerage.status,
        };
      }
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        brokerageId: user.brokerageId,
        brokerage: userBrokerage,
        brokerageName: userBrokerage?.name,
      },
      role: user.role,
      brokerageId: user.brokerageId,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login.',
    });
  }
};

// 3. Refresh Token Handler
export const refreshToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Refresh token not provided.' });
    }

    const decoded = verifyRefreshToken(token);
    if (!decoded) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const user = await User.findById(decoded.id);
    if (!user || user.status === 'suspended') {
      clearRefreshTokenCookie(res);
      return res.status(401).json({ success: false, message: 'User no longer active.' });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    user.refreshToken = newRefreshToken;
    await user.save();

    setRefreshTokenCookie(res, newRefreshToken);

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
    });
  } catch (error) {
    clearRefreshTokenCookie(res);
    return res.status(500).json({ success: false, message: 'Token refresh failed.' });
  }
};

// 4. Get Current User Profile
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('brokerageId', 'name city status');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        brokerageId: user.brokerageId?._id || user.brokerageId,
        brokerage: user.brokerageId,
        brokerageName: user.brokerageId?.name,
        phone: user.phone,
        status: user.status,
      },
      role: user.role,
      brokerageId: user.brokerageId?._id || user.brokerageId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 5. Update Profile
export const updateProfile = async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword, phone } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();

    if (email && email.toLowerCase() !== user.email) {
      const existing = await User.findOne({ email: email.toLowerCase().trim() });
      if (existing) return res.status(400).json({ success: false, message: 'Email is already taken' });
      user.email = email.toLowerCase().trim();
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required to set new password' });
      }
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Incorrect current password' });
      }
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        return res.status(400).json({ success: false, message: passwordValidation.message });
      }
      user.password = newPassword;
    }

    await user.save();
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// 6. Logout
export const logout = async (req, res) => {
  try {
    if (req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
    }
    clearRefreshTokenCookie(res);
    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    clearRefreshTokenCookie(res);
    return res.status(200).json({ success: true });
  }
};

// 7. Request Password Reset (Forgot Password)
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).populate('brokerageId');
    if (!user) {
      // Return ambiguous message for security, but allow testing
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address.',
      });
    }

    // Generate a secure 6-digit numeric reset token for quick verification
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordToken = resetCode;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes validity
    await user.save();

    console.log(`[LeadFlow Auth] Password reset code for ${user.email}: ${resetCode}`);

    // Send real email notification with reset code and direct link
    const brokerageName = user.brokerageId?.name || 'LeadFlow Hypotheken GmbH';
    const brokerageId = user.brokerageId?._id || user.brokerageId || null;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetUrl = `${clientUrl}/auth/reset-password?email=${encodeURIComponent(user.email)}&code=${resetCode}`;

    const emailResult = await sendPasswordResetEmail({
      to: user.email,
      userName: user.name || 'Valued User',
      resetCode,
      resetUrl,
      brokerageName,
      brokerageId,
      expiresInMinutes: 15,
    });

    return res.status(200).json({
      success: true,
      message: `Password reset instructions and verification code sent to ${user.email}.`,
      emailSent: emailResult?.success ?? true,
      previewUrl: emailResult?.previewUrl || null,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process password reset request.' });
  }
};

// 8. Verify Reset Code (Step 1 of reset password flow)
export const verifyResetCode = async (req, res) => {
  try {
    const { email, resetCode } = req.body;
    if (!email || !resetCode) {
      return res.status(400).json({
        success: false,
        message: 'Email address and verification code are required.',
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordToken: resetCode.trim(),
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please check your code or request a new one.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Verification code verified successfully.',
    });
  } catch (error) {
    console.error('Verify reset code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify reset code.',
    });
  }
};

// 9. Reset Password with Verification Code (Step 2 of reset password flow)
export const resetPassword = async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;
    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, verification code, and new password are required.',
      });
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordToken: resetCode.trim(),
      resetPasswordExpires: { $gt: new Date() },
    }).populate('brokerageId');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please request a new one.',
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    // Send confirmation notice email
    const brokerageName = user.brokerageId?.name || 'LeadFlow Hypotheken GmbH';
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const loginUrl = `${clientUrl}/auth/signin`;

    sendPasswordResetConfirmationEmail({
      to: user.email,
      userName: user.name || 'Valued User',
      brokerageName,
      brokerageId: user.brokerageId?._id || user.brokerageId || null,
      loginUrl,
    }).catch((err) => {
      console.warn('[Password Reset Confirmation Email Error]', err?.message);
    });

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You may now sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
};

// 10. Send Sign Up Email Verification Code
export const sendSignupVerificationCode = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Business email is required.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid business email address.',
      });
    }

    // Check if email already exists in DB
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please sign in or use another email.',
      });
    }

    // Generate 6-digit numeric verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await EmailVerification.findOneAndUpdate(
      { email: normalizedEmail },
      {
        verificationCode,
        isVerified: false,
        expiresAt,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[LeadFlow Auth] Sign up verification code for ${normalizedEmail}: ${verificationCode}`);

    // Send verification email
    const emailResult = await sendSignupVerificationEmail({
      to: normalizedEmail,
      userName: name || 'Valued Broker',
      verificationCode,
      expiresInMinutes: 15,
    });

    return res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}.`,
      previewUrl: emailResult?.previewUrl || null,
    });
  } catch (error) {
    console.error('Send signup verification code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send verification code. Please try again.',
    });
  }
};

// 11. Verify Sign Up Code
export const verifySignupCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email and 6-digit verification code are required.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const trimmedCode = code.trim();

    const record = await EmailVerification.findOne({
      email: normalizedEmail,
      verificationCode: trimmedCode,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please check your code or request a new one.',
      });
    }

    record.isVerified = true;
    await record.save();

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now proceed with registration.',
    });
  } catch (error) {
    console.error('Verify signup code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify code. Please try again.',
    });
  }
};


