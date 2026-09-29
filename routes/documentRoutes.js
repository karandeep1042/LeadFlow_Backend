import express from 'express';
import {
  getDocuments,
  uploadDocument,
  approveDocument,
  rejectDocument,
  reverifyDocument,
} from '../controllers/documentController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { uploadLimiter } from '../middlewares/rateLimiter.js';
import { ROLES, STAFF_ROLES } from '../utils/constants.js';

const router = express.Router();

router.use(authenticate, enforceTenantScope);

// Client + Staff can view and upload documents
router.get('/', authorize([ROLES.BROKERAGE_ADMIN, ROLES.ADVISOR, ROLES.CLIENT]), getDocuments);
router.get('/case/:caseId', authorize([ROLES.BROKERAGE_ADMIN, ROLES.ADVISOR, ROLES.CLIENT]), getDocuments);
router.post('/upload', authorize([ROLES.BROKERAGE_ADMIN, ROLES.ADVISOR, ROLES.CLIENT]), uploadLimiter, uploadDocument);

// Only Advisors & Brokerage Admin can approve, reject, or reverify documents
router.patch('/:docId/approve', authorize(STAFF_ROLES), approveDocument);
router.patch('/:docId/reject', authorize(STAFF_ROLES), rejectDocument);
router.patch('/:docId/reverify', authorize(STAFF_ROLES), reverifyDocument);

export default router;
