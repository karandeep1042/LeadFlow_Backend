import express from 'express';
import {
  getSources,
  createSource,
  updateSource,
  deleteSource,
  testWebhook,
  updateSourceStatus,
  handleInboundWebhook,
} from '../controllers/integrationController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { webhookLimiter } from '../middlewares/rateLimiter.js';
import { ROLES } from '../utils/constants.js';

const router = express.Router();

// 1. Public Inbound Webhook endpoint (protected by webhook rate limiter, called by external portals)
router.post('/webhook/:sourceId', webhookLimiter, handleInboundWebhook);

// 2. Protected Brokerage Admin integration endpoints
router.use(authenticate, authorize([ROLES.BROKERAGE_ADMIN]), enforceTenantScope);

router.get('/sources', getSources);
router.post('/sources', createSource);
router.put('/sources/:sourceId', updateSource);
router.delete('/sources/:sourceId', deleteSource);
router.post('/sources/:sourceId/test', testWebhook);
router.patch('/sources/:sourceId/status', updateSourceStatus);

export default router;

