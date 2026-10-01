import express from 'express';
import {
  getTenants,
  createTenant,
  updateTenantStatus,
  updateTenantDetails,
  getTenantMetrics,
  getPlatformOverviewMetrics,
  testSmtpConnection,
  updateSuperAdminProfile,
  updateSuperAdminPassword,
} from '../controllers/tenantController.js';
import {
  getPlatformTemplates,
  getPlatformTemplateByKey,
  updatePlatformTemplate,
  resetPlatformTemplate,
  sendTestEmail,
} from '../controllers/platformEmailController.js';
import {
  getPlatformHealth,
  testPlatformService,
  updatePlatformServiceCredentials,
} from '../controllers/diagnosticsController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import { ROLES } from '../utils/constants.js';

const router = express.Router();

// All platform-admin routes are strictly protected for Platform Admins only
router.use(authenticate, authorize([ROLES.PLATFORM_ADMIN]));

// 1. Tenancy Management
router.get('/tenants', getTenants);
router.post('/tenants', createTenant);
router.patch('/tenants/:tenantId/status', updateTenantStatus);
router.patch('/tenants/:tenantId/details', updateTenantDetails);
router.get('/tenants/:tenantId/metrics', getTenantMetrics);

// 2. Platform Analytics & Overview
router.get('/metrics/overview', getPlatformOverviewMetrics);

// 3. Platform Email Templates Engine
router.get('/email-templates', getPlatformTemplates);
router.get('/email-templates/:key', getPlatformTemplateByKey);
router.put('/email-templates/:key', updatePlatformTemplate);
router.post('/email-templates/:key/reset', resetPlatformTemplate);
router.post('/email-templates/:key/test', sendTestEmail);

// 4. Global Settings, Profile & Diagnostics
router.get('/diagnostics/health', getPlatformHealth);
router.post('/diagnostics/test/:type', testPlatformService);
router.put('/diagnostics/credentials/:type', updatePlatformServiceCredentials);
router.get('/diagnostics/smtp', testSmtpConnection);
router.put('/profile', updateSuperAdminProfile);
router.put('/password', updateSuperAdminPassword);

export default router;

