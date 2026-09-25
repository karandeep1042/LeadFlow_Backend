import express from 'express';
import {
  registerBrokerage,
  login,
  refreshToken,
  getCurrentUser,
  updateProfile,
  logout,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import { ALL_ROLES } from '../utils/constants.js';

const router = express.Router();

// Public Routes (No auth required)
router.post('/register-brokerage', registerBrokerage);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected Routes (Require Authentication + Role Authorization)
router.get('/me', authenticate, authorize(ALL_ROLES), getCurrentUser);
router.patch('/profile', authenticate, authorize(ALL_ROLES), updateProfile);
router.post('/logout', authenticate, authorize(ALL_ROLES), logout);

export default router;


