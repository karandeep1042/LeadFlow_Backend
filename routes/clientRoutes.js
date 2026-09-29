import express from 'express';
import { getClients, updateClientStatus, getClientPortalOverview } from '../controllers/clientController.js';
import { authenticate, authorize, enforceTenantScope } from '../middlewares/authMiddleware.js';
import { STAFF_ROLES, ROLES } from '../utils/constants.js';

const router = express.Router();

// Borrower portal overview accessible by client role, advisors and admins
router.get(
  '/portal-me',
  authenticate,
  authorize([ROLES.CLIENT, ROLES.BROKERAGE_ADMIN, ROLES.ADVISOR]),
  enforceTenantScope,
  getClientPortalOverview
);

// Staff client management routes
router.get('/', authenticate, authorize(STAFF_ROLES), enforceTenantScope, getClients);
router.patch('/:clientId/status', authenticate, authorize(STAFF_ROLES), enforceTenantScope, updateClientStatus);

export default router;
