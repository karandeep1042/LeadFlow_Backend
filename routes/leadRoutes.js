import express from 'express';
import {
  getLeads,
  createLead,
  updateLeadStage,
  assignAdvisor,
  convertToClient,
  resolveDuplicate,
  addNote,
  declineLead,
  archiveLead,
  unarchiveLead,
} from '../controllers/leadController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { STAFF_ROLES } from '../utils/constants.js';

const router = express.Router();

// All lead routes require authentication, staff role authorization, and tenant scoping
router.use(authenticate, authorize(STAFF_ROLES), enforceTenantScope);

router.get('/', getLeads);
router.post('/', createLead);
router.patch('/:leadId/stage', updateLeadStage);
router.patch('/:leadId/assign', assignAdvisor);
router.post('/:leadId/convert', convertToClient);
router.post('/:leadId/resolve-duplicate', resolveDuplicate);
router.post('/:leadId/notes', addNote);
router.post('/:leadId/decline', declineLead);
router.post('/:leadId/archive', archiveLead);
router.post('/:leadId/unarchive', unarchiveLead);

export default router;

