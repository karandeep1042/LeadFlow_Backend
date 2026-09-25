import express from 'express';
import {
  getTemplates,
  saveTemplate,
  updateTemplate,
  getTriggers,
  updateTrigger,
  toggleTriggerStatus,
} from '../controllers/automationController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { ROLES } from '../utils/constants.js';

const router = express.Router();

router.use(authenticate, authorize([ROLES.BROKERAGE_ADMIN]), enforceTenantScope);

router.get('/templates', getTemplates);
router.post('/templates', saveTemplate);
router.put('/templates/:templateId', updateTemplate);
router.get('/triggers', getTriggers);
router.post('/triggers', updateTrigger);
router.patch('/triggers/:triggerId/status', toggleTriggerStatus);

export default router;

