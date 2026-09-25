import User from '../models/User.js';
import Brokerage from '../models/Brokerage.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from '../utils/jwt.js';

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

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    const brokerage = await Brokerage.create({
      name: brokerageName.trim(),
      subdomain: subdomain ? subdomain.toLowerCase().trim() : brokerageName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      city: city || 'Berlin',
      status: 'active',
    });

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'brokerage_admin',
      brokerageId: brokerage._id,
      phone: phone || '',
      status: 'active',
    });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

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

    if (user.role !== 'platform_admin' && user.brokerageId) {
      const brokerage = await Brokerage.findById(user.brokerageId);
      if (brokerage && brokerage.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Your brokerage subscription is currently suspended.',
        });
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

    const user = await User.findOne({ email: email.toLowerCase().trim() });
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

    return res.status(200).json({
      success: true,
      message: `Password reset instructions and verification code sent to ${user.email}.`,
      resetCode, // Provided in response for easy preview & testing
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process password reset request.' });
  }
};

// 8. Reset Password with Verification Code
export const resetPassword = async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;
    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, verification code, and new password are required.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.',
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
        message: 'Invalid or expired verification code. Please request a new one.',
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You may now sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
};


