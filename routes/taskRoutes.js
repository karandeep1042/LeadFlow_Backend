import express from 'express';
import { getTasks, getTaskAnalytics, createTask, completeTask, updateTask, deleteTask } from '../controllers/taskController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { STAFF_ROLES } from '../utils/constants.js';

const router = express.Router();

router.use(authenticate, authorize(STAFF_ROLES), enforceTenantScope);

router.get('/analytics', getTaskAnalytics);
router.get('/', getTasks);
router.post('/', createTask);
router.patch('/:taskId/complete', completeTask);
router.patch('/:taskId', updateTask);
router.delete('/:taskId', deleteTask);

export default router;

