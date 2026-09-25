import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';

/**
 * Authentication Middleware:
 * Verifies JWT access token from Authorization header or Cookie,
 * loads active user from DB, and attaches to req.user.
 */
export const authenticate = async (req, res, next) => {
  try {
    let token = null;

    // 1. Extract Bearer token from Authorization Header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please provide a valid access token.',
      });
    }

    // 2. Verify Access Token
    const decoded = verifyAccessToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired access token.',
      });
    }

    // 3. Find User & Check Status
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account no longer exists.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact your administrator.',
      });
    }

    // 4. Attach user context to request
    req.user = user;
    req.userRole = user.role;
    req.brokerageId = user.brokerageId;

    next();
  } catch (error) {
    console.error('Authentication Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication server error.',
    });
  }
};

// Backwards compatibility alias
export const authenticateUser = authenticate;

/**
 * Authorization Middleware:
 * Accepts an array of allowed roles (e.g. `authorize(['platform_admin', 'brokerage_admin'])`)
 * or comma-separated roles (e.g. `authorize('platform_admin', 'brokerage_admin')`).
 * Validates that req.user.role matches one of the allowed roles.
 */
export const authorize = (...rolesInput) => {
  // Normalize input so it supports both:
  // authorize(['admin', 'advisor']) AND authorize('admin', 'advisor')
  const allowedRoles = Array.isArray(rolesInput[0]) ? rolesInput[0] : rolesInput;

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required prior to authorization check.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access restricted. Your role '${req.user.role}' is not authorized to access this resource. Allowed roles: [${allowedRoles.join(', ')}]`,
      });
    }

    next();
  };
};

// Backwards compatibility alias
export const authorizeRoles = authorize;

/**
 * Multi-Tenant Data Isolation Scope Enforcer:
 * Verifies tenant boundary and attaches `req.tenantFilter` for Mongoose queries.
 */
export const enforceTenantScope = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Platform admin can query across all tenants globally
  if (req.user.role === 'platform_admin') {
    req.tenantFilter = {};
    return next();
  }

  // All other roles must have a valid brokerageId
  if (!req.user.brokerageId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: User is not linked to any active brokerage tenant.',
    });
  }

  // Automatically enforce tenant filter on database queries
  req.tenantFilter = { brokerageId: req.user.brokerageId };
  next();
};

