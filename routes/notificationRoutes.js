import express from 'express';
import { authenticate, enforceTenantScope } from '../middlewares/authMiddleware.js';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  clearAllNotifications,
  deleteNotification,
} from '../controllers/notificationController.js';

const router = express.Router();

router.use(authenticate, enforceTenantScope);

router.get('/', getNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:notificationId/read', markAsRead);
router.delete('/clear-all', clearAllNotifications);
router.delete('/:notificationId', deleteNotification);

export default router;


