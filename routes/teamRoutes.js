import express from 'express';
import {
  getAdvisors,
  inviteAdvisor,
  updateAdvisorStatus,
} from '../controllers/teamController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { ROLES, STAFF_ROLES } from '../utils/constants.js';

const router = express.Router();

// Base middleware for all team routes: authenticate and scope to tenant
router.use(authenticate, enforceTenantScope);

// Both brokerage admins and advisors can access the advisors team roster
router.get('/advisors', authorize(STAFF_ROLES), getAdvisors);

// Only brokerage admins can invite advisors or modify advisor account status
router.post('/advisors/invite', authorize([ROLES.BROKERAGE_ADMIN]), inviteAdvisor);
router.patch('/advisors/:advisorId/status', authorize([ROLES.BROKERAGE_ADMIN]), updateAdvisorStatus);

export default router;
