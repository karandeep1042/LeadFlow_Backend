import { Server } from 'socket.io';
import { verifyAccessToken } from './jwt.js';
import User from '../models/User.js';
import Brokerage from '../models/Brokerage.js';

let io = null;

/**
 * Initialize Socket.IO with HTTP server and CORS configuration
 */
export const initSocket = (httpServer, corsOptions) => {
  io = new Server(httpServer, {
    cors: corsOptions || {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Socket Authentication & Room Assignment Middleware
  io.use(async (socket, next) => {
    try {
      // 1. Extract Token from handshake auth, headers, or query
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
        socket.handshake.query?.token;

      if (!token) {
        return next(new Error('Socket Authentication Error: Token missing'));
      }

      // 2. Verify JWT Access Token
      const decoded = verifyAccessToken(token);
      if (!decoded || !decoded.id) {
        return next(new Error('Socket Authentication Error: Invalid or expired token'));
      }

      // 3. Look up active user in MongoDB
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return next(new Error('Socket Authentication Error: User account not found'));
      }

      if (user.status === 'suspended') {
        return next(new Error('Socket Authentication Error: User is suspended'));
      }

      // 4. Verify Brokerage is not suspended (for non platform_admin)
      if (user.role !== 'platform_admin' && user.brokerageId) {
        const brokerage = await Brokerage.findById(user.brokerageId);
        if (brokerage && brokerage.status === 'suspended') {
          return next(new Error('Socket Authentication Error: Brokerage tenant is suspended'));
        }
      }

      // Attach authenticated user details to socket instance
      socket.user = {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        brokerageId: user.brokerageId ? user.brokerageId.toString() : null,
      };

      return next();
    } catch (error) {
      console.error('[Socket Auth Error]:', error.message);
      return next(new Error('Socket Authentication Error: Server exception'));
    }
  });

  // Socket Connection Handler
  io.on('connection', (socket) => {
    const { _id, name, role, brokerageId } = socket.user || {};

    // 1. Join Organization-Specific Room for strict multi-tenant isolation
    if (brokerageId) {
      const brokerageRoom = `brokerage:${brokerageId}`;
      socket.join(brokerageRoom);
      console.log(`[Socket Connected] User ${name} (${role}) joined tenant room: ${brokerageRoom}`);

      // Role-specific room within the brokerage tenant
      if (role) {
        const roleRoom = `brokerage:${brokerageId}:${role}`;
        socket.join(roleRoom);
        console.log(`[Socket Connected] User ${name} joined tenant role room: ${roleRoom}`);
      }
    }

    // 2. Join User-Specific Room
    if (_id) {
      const userRoom = `user:${_id}`;
      socket.join(userRoom);
    }

    // 3. Platform Admin Room
    if (role === 'platform_admin') {
      socket.join('platform_admins');
    }

    socket.on('disconnect', (reason) => {
      console.log(`[Socket Disconnected] User ${name} (${role}) disconnected. Reason: ${reason}`);
    });
  });

  return io;
};

/**
 * Get the current initialized Socket.IO instance
 */
export const getIO = () => {
  if (!io) {
    console.warn('[Socket Warning] Socket.io has not been initialized yet.');
  }
  return io;
};

/**
 * Emit real-time event strictly to users within a specific brokerage organization
 *
 * @param {string|import('mongoose').Types.ObjectId} brokerageId
 * @param {string} event
 * @param {any} data
 */
export const emitToBrokerage = (brokerageId, event, data) => {
  if (!io || !brokerageId) return;
  const room = `brokerage:${brokerageId.toString()}`;
  io.to(room).emit(event, data);
};

/**
 * Emit real-time event to users of a specific role within a brokerage
 *
 * @param {string|import('mongoose').Types.ObjectId} brokerageId
 * @param {string} role
 * @param {string} event
 * @param {any} data
 */
export const emitToRole = (brokerageId, role, event, data) => {
  if (!io || !brokerageId || !role) return;
  const room = `brokerage:${brokerageId.toString()}:${role}`;
  io.to(room).emit(event, data);
};

/**
 * Emit real-time event to a specific user
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} event
 * @param {any} data
 */
export const emitToUser = (userId, event, data) => {
  if (!io || !userId) return;
  const rawId = typeof userId === 'object' && userId._id ? userId._id : userId;
  const room = `user:${rawId.toString()}`;
  io.to(room).emit(event, data);
};

/**
 * Emit real-time event to all connected Platform Admins
 *
 * @param {string} event
 * @param {any} data
 */
export const emitToPlatformAdmins = (event, data) => {
  if (!io) return;
  io.to('platform_admins').emit(event, data);
};

