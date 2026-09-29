import mongoose from 'mongoose';
import SystemConfig from '../models/SystemConfig.js';
import { isRedisReady, testRedisConnection, initRedisClient, getCurrentRedisUrl, getRedisClient } from '../utils/redis.js';
import { testDatabaseConnection, connectDB, getCurrentMongoUri } from '../utils/db.js';
import { testSmtpConfig, setTransporterConfig, getCurrentSmtpConfig } from '../utils/emailService.js';

/**
 * 1. Get Platform Infrastructure Health & Sanitized Configs
 */
export const getPlatformHealth = async (req, res) => {
  try {
    // 1. Database Health
    const dbStartTime = Date.now();
    let dbStatus = 'disconnected';
    let dbLatencyMs = 0;
    let dbCollections = 0;
    let dbHost = '127.0.0.1';
    let dbName = 'leadflow';

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      try {
        await mongoose.connection.db.admin().ping();
        dbLatencyMs = Date.now() - dbStartTime;
        dbStatus = 'connected';
        const cols = await mongoose.connection.db.listCollections().toArray();
        dbCollections = cols.length;
        dbHost = mongoose.connection.host || '127.0.0.1';
        dbName = mongoose.connection.name || 'leadflow';
      } catch (err) {
        dbStatus = 'error';
      }
    }

    // 2. Redis Health
    const redisStartTime = Date.now();
    let redisStatus = isRedisReady() ? 'connected' : 'fallback_memory';
    let redisLatencyMs = 0;
    let redisKeyCount = 0;
    const redisClient = getRedisClient();

    if (redisClient && isRedisReady()) {
      try {
        await redisClient.ping();
        redisLatencyMs = Date.now() - redisStartTime;
        redisKeyCount = await redisClient.dbsize();
      } catch (_) {
        redisStatus = 'fallback_memory';
      }
    }

    // 3. SMTP Health
    const smtpConfig = getCurrentSmtpConfig();
    const smtpHealth = await testSmtpConfig();

    // Sanitized Configs
    const mongoUri = getCurrentMongoUri();
    const maskedMongoUri = mongoUri ? mongoUri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••••••@') : '';

    const redisUrl = getCurrentRedisUrl();
    const maskedRedisUrl = redisUrl ? redisUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••••••@') : '';

    return res.status(200).json({
      success: true,
      data: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
          host: dbHost,
          databaseName: dbName,
          collectionsCount: dbCollections,
          maskedUri: maskedMongoUri,
          rawUri: mongoUri,
        },
        redis: {
          status: redisStatus,
          mode: isRedisReady() ? 'Redis Active Cluster/Instance' : 'In-Memory Cache Fallback',
          latencyMs: redisLatencyMs,
          keyCount: redisKeyCount,
          maskedUrl: maskedRedisUrl,
          rawUrl: redisUrl,
        },
        smtp: {
          status: smtpHealth.success ? (smtpConfig.hasPass ? 'connected' : 'mock_ethereal') : 'error',
          message: smtpHealth.message,
          latencyMs: smtpHealth.latencyMs || 0,
          service: smtpConfig.service,
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          user: smtpConfig.user,
          hasPass: smtpConfig.hasPass,
        },
      },
    });
  } catch (error) {
    console.error('getPlatformHealth error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Test Connection for a Specific Service
 */
export const testPlatformService = async (req, res) => {
  try {
    const { type } = req.params;
    const payload = req.body || {};

    if (type === 'database') {
      const result = await testDatabaseConnection(payload.mongoUri);
      return res.status(result.success ? 200 : 400).json(result);
    }

    if (type === 'redis') {
      const result = await testRedisConnection(payload.redisUrl);
      return res.status(result.success ? 200 : 400).json(result);
    }

    if (type === 'smtp') {
      const result = await testSmtpConfig(payload);
      return res.status(result.success ? 200 : 400).json(result);
    }

    return res.status(400).json({ success: false, message: `Invalid service type "${type}"` });
  } catch (error) {
    console.error('testPlatformService error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Update & Reload Service Credentials
 */
export const updatePlatformServiceCredentials = async (req, res) => {
  try {
    const { type } = req.params;
    const payload = req.body || {};

    if (type === 'database') {
      const { mongoUri } = payload;
      if (!mongoUri || !mongoUri.trim()) {
        return res.status(400).json({ success: false, message: 'MongoDB Connection URI is required.' });
      }

      const testResult = await testDatabaseConnection(mongoUri.trim());
      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          message: `Database verification failed: ${testResult.message}`,
        });
      }

      await connectDB(mongoUri.trim());
      await SystemConfig.findOneAndUpdate(
        { key: 'database' },
        {
          key: 'database',
          config: { mongoUri: mongoUri.trim() },
          lastStatus: 'connected',
          lastMessage: testResult.message,
          lastTestedAt: new Date(),
          latencyMs: testResult.latencyMs || 0,
          updatedBy: req.user?._id,
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        message: 'Database connection updated and verified successfully.',
        details: testResult.details,
      });
    }

    if (type === 'redis') {
      const { redisUrl } = payload;
      let effectiveUrl = redisUrl ? redisUrl.trim() : '';
      let testDetails = null;

      if (effectiveUrl) {
        const testResult = await testRedisConnection(effectiveUrl);
        if (!testResult.success) {
          return res.status(400).json({
            success: false,
            message: `Redis verification failed: ${testResult.message}`,
          });
        }
        if (testResult.normalizedUrl) {
          effectiveUrl = testResult.normalizedUrl;
        }
        testDetails = testResult.details;
      }

      initRedisClient(effectiveUrl);
      await SystemConfig.findOneAndUpdate(
        { key: 'redis' },
        {
          key: 'redis',
          config: { redisUrl: effectiveUrl },
          lastStatus: effectiveUrl ? 'connected' : 'fallback',
          lastMessage: effectiveUrl ? 'Redis active' : 'Running in memory fallback mode',
          lastTestedAt: new Date(),
          updatedBy: req.user?._id,
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        message: effectiveUrl ? 'Redis configuration updated and connected successfully.' : 'Switched to in-memory cache mode.',
        details: testDetails,
      });
    }

    if (type === 'smtp') {
      const { service, host, port, secure, user, pass } = payload;
      if (!user) {
        return res.status(400).json({ success: false, message: 'SMTP User/Email is required.' });
      }

      const testResult = await testSmtpConfig({ service, host, port, secure, user, pass });
      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          message: `SMTP verification failed: ${testResult.message}`,
        });
      }

      setTransporterConfig({ service, host, port, secure, user, pass });
      await SystemConfig.findOneAndUpdate(
        { key: 'smtp' },
        {
          key: 'smtp',
          config: { service, host, port, secure, user },
          lastStatus: 'connected',
          lastMessage: testResult.message,
          lastTestedAt: new Date(),
          latencyMs: testResult.latencyMs || 0,
          updatedBy: req.user?._id,
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        message: 'Email & SMTP transport credentials updated and verified.',
        details: testResult.details,
      });
    }

    return res.status(400).json({ success: false, message: `Invalid service type "${type}"` });
  } catch (error) {
    console.error('updatePlatformServiceCredentials error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
