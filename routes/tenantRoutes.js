import express from 'express';
import {
  getTenants,
  createTenant,
  updateTenantStatus,
  getTenantMetrics,
  getPlatformOverviewMetrics,
} from '../controllers/tenantController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import { ROLES } from '../utils/constants.js';

const router = express.Router();

// All tenant routes are restricted to Platform Admin only
router.use(authenticate, authorize([ROLES.PLATFORM_ADMIN]));

router.get('/tenants', getTenants);
router.post('/tenants', createTenant);
router.patch('/tenants/:tenantId/status', updateTenantStatus);
router.get('/tenants/:tenantId/metrics', getTenantMetrics);
router.get('/metrics/overview', getPlatformOverviewMetrics);

export default router;
