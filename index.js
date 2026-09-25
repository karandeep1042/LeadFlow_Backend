import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { connectDB } from './utils/db.js';
import { seedDefaultDemoAccounts } from './utils/seedData.js';

import authRoutes from './routes/authRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import automationRoutes from './routes/automationRoutes.js';
import teamRoutes from './routes/teamRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Middleware
app.use(
  cors({
    origin: [CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'LeadFlow API',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/platform-admin', tenantRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/team', teamRoutes);

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

  app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`🚀 LeadFlow Server running on port ${PORT}`);
    console.log(`🌍 Client Allowed Origin: ${CLIENT_URL}`);
    console.log(`🔑 Auth Endpoints active at /api/auth/*`);
    console.log(`🛡️ Role-Based Authorization active across all routes`);
    console.log(`==========================================`);
  });
};

startServer();

export default app;


