import express from 'express';
import {
  registerBrokerage,
  login,
  switchWorkspace,
  refreshToken,
  getCurrentUser,
  updateProfile,
  setInitialPassword,
  logout,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  sendSignupVerificationCode,
  verifySignupCode,
} from '../controllers/authController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import {
  authLimiter,
  passwordResetLimiter,
  verifyResetCodeLimiter,
} from '../middlewares/rateLimiter.js';
import { ALL_ROLES } from '../utils/constants.js';

const router = express.Router();

// Public Routes (Protected by specialized rate limiters)
router.post('/register-brokerage', authLimiter, registerBrokerage);
router.post('/send-signup-verification-code', passwordResetLimiter, sendSignupVerificationCode);
router.post('/verify-signup-code', verifyResetCodeLimiter, verifySignupCode);
router.post('/login', authLimiter, login);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/verify-reset-code', verifyResetCodeLimiter, verifyResetCode);
router.post('/reset-password', passwordResetLimiter, resetPassword);

// Protected Routes (Require Authentication + Role Authorization)
router.get('/me', authenticate, authorize(ALL_ROLES), getCurrentUser);
router.post('/switch-workspace', authenticate, authorize(ALL_ROLES), switchWorkspace);
router.patch('/profile', authenticate, authorize(ALL_ROLES), updateProfile);
router.post('/set-initial-password', authenticate, authorize(ALL_ROLES), setInitialPassword);
router.post('/logout', authenticate, authorize(ALL_ROLES), logout);

export default router;


