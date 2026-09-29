import express from 'express';
import { getBrokerageDashboardStats } from '../controllers/brokerageDashboardController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { STAFF_ROLES } from '../utils/constants.js';

const router = express.Router();

// Route restricted to authenticated staff (Brokerage Admin / Advisor) and scoped to tenant
router.use(authenticate, authorize(STAFF_ROLES), enforceTenantScope);

router.get('/dashboard', getBrokerageDashboardStats);

export default router;
