import './utils/dotenvLoader.js';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './utils/db.js';
import { seedDefaultDemoAccounts } from './utils/seedData.js';
import { initSocket } from './utils/socket.js';
import { initKeepAliveCron } from './utils/keepAliveCron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/authRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import automationRoutes from './routes/automationRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import brokerageDashboardRoutes from './routes/brokerageDashboardRoutes.js';
import clientRoutes from './routes/clientRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { globalApiLimiter } from './middlewares/rateLimiter.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Trust reverse proxy (Render, Netlify, Cloudflare, load balancers)
app.set('trust proxy', 1);

const corsOptions = {
  origin: [CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static uploaded documents for local storage fallback
const uploadsDir = path.resolve(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Initialize Socket.IO Server attached to HTTP server
initSocket(server, corsOptions);

// Health Check Endpoint (not rate-limited, accessible via /health and /api/health)
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'LeadFlow API',
    environment: process.env.NODE_ENV || 'development',
    realtime: 'Socket.IO Enabled',
  });
});

// Global API Rate Limiter
app.use('/api', globalApiLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/platform-admin', tenantRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/brokerage', brokerageDashboardRoutes);
app.use('/api/notifications', notificationRoutes);

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start Server
const startServer = async () => {
  await connectDB();
  await seedDefaultDemoAccounts();

  server.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`[Server] LeadFlow Server running on port ${PORT}`);
    console.log(`[Origin] Client Allowed Origin: ${CLIENT_URL}`);
    console.log(`[Socket.IO] Real-time active with organization isolation`);
    console.log(`[Auth] Endpoints active at /api/auth/*`);
    console.log(`[RBAC] Role-Based Authorization active across all routes`);
    console.log(`==========================================`);

    // Start 30s Keep-Alive Cronjob to prevent Render free-tier instance from sleeping
    initKeepAliveCron(PORT);
  });
};

startServer();

export { app, server };
export default app;


