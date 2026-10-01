import mongoose from 'mongoose';
import SystemConfig from '../models/SystemConfig.js';
import { isRedisReady, testRedisConnection, initRedisClient, getCurrentRedisUrl, getRedisClient, getRedisHost, resolveRedisConfig } from '../utils/redis.js';
import { testDatabaseConnection, connectDB, getCurrentMongoUri, parseMongoUriInfo, maskMongoUri } from '../utils/db.js';
import { testSmtpConfig, setTransporterConfig, getCurrentSmtpConfig } from '../utils/emailService.js';
import { updateEnvVariable } from '../utils/envHelper.js';
import {
  getEmailQueueStats,
  flushEmailQueue,
  retryFailedEmailJob,
  retryAllFailedJobs,
  deleteEmailQueueJob,
} from '../services/emailQueueService.js';

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
    const mongoUri = getCurrentMongoUri();
    const uriInfo = parseMongoUriInfo(mongoUri);
    let dbHost = uriInfo.host || '127.0.0.1';
    let dbName = uriInfo.databaseName || 'leadflow';

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      try {
        const pingStart = Date.now();
        await mongoose.connection.db.admin().ping();
        dbLatencyMs = Date.now() - pingStart;
        dbStatus = 'connected';
        const cols = await mongoose.connection.db.listCollections().toArray();
        dbCollections = cols.length;
        dbHost = uriInfo.host || mongoose.connection.host || '127.0.0.1';
        dbName = mongoose.connection.name || uriInfo.databaseName || 'leadflow';
      } catch (err) {
        dbStatus = 'error';
      }
    }

    // 2. Redis Health
    const redisStartTime = Date.now();
    let redisStatus = 'fallback_memory';
    let redisLatencyMs = 0;
    let redisKeyCount = 0;
    const redisClient = getRedisClient();
    const redisUrl = getCurrentRedisUrl();
    const redisHost = getRedisHost();
    const redisResolved = resolveRedisConfig(redisUrl);

    if (redisClient) {
      try {
        const pingStart = Date.now();
        const pingRes = await redisClient.ping();
        if (pingRes) {
          redisLatencyMs = Date.now() - pingStart;
          redisStatus = 'connected';
          try {
            redisKeyCount = await redisClient.dbsize();
          } catch (_) {}
        }
      } catch (_) {
        redisStatus = 'fallback_memory';
      }
    }

    let redisMode = 'In-Memory Cache Fallback';
    if (redisStatus === 'connected') {
      if (redisResolved?.isUpstash) {
        redisMode = 'Upstash Serverless Redis (Cloud)';
      } else if (redisResolved?.isCloud) {
        redisMode = 'Redis Active Cloud Cluster';
      } else {
        redisMode = 'Redis Active Instance';
      }
    }

    // Retrieve custom hostName / alias from SystemConfig or env
    let configuredHostName = process.env.REDIS_HOST_NAME || '';
    try {
      const redisConfigDoc = await SystemConfig.findOne({ key: 'redis' }).lean();
      if (redisConfigDoc?.config?.hostName) {
        configuredHostName = redisConfigDoc.config.hostName;
      }
    } catch (_) {}

    const displayHostName = configuredHostName || (redisStatus === 'connected' ? (redisResolved?.isUpstash ? 'Upstash Redis Cloud' : redisHost) : 'In-Memory Cache');

    // 3. SMTP Health
    const smtpConfig = getCurrentSmtpConfig();
    const smtpHealth = await testSmtpConfig();

    // 4. Email Queue & DLQ Health
    const emailQueueStats = await getEmailQueueStats({ limit: 10 });

    // Sanitized Configs
    const maskedMongoUri = maskMongoUri(mongoUri);
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
          hostName: displayHostName,
          configuredHostName: configuredHostName,
          host: redisHost,
          mode: redisMode,
          keyCount: redisKeyCount,
          latencyMs: redisLatencyMs,
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
        emailQueue: {
          status: (emailQueueStats?.counts?.failed || 0) > 0 ? 'dlq_alert' : 'healthy',
          counts: emailQueueStats?.counts || { pending: 0, processing: 0, sent: 0, failed: 0, total: 0 },
          recentItems: emailQueueStats?.items || [],
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

      const cleanUri = mongoUri.trim();
      const testResult = await testDatabaseConnection(cleanUri);
      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          message: `Database verification failed: ${testResult.message}`,
        });
      }

      await connectDB(cleanUri);
      process.env.MONGO_URI = cleanUri;
      updateEnvVariable('MONGO_URI', cleanUri);

      await SystemConfig.findOneAndUpdate(
        { key: 'database' },
        {
          key: 'database',
          config: { mongoUri: cleanUri },
          lastStatus: 'connected',
          lastMessage: testResult.message,
          lastTestedAt: new Date(),
          latencyMs: testResult.latencyMs || 0,
          updatedBy: req.user?._id,
        },
        { upsert: true, returnDocument: 'after' }
      );

      return res.status(200).json({
        success: true,
        message: 'Database connection updated and verified successfully.',
        details: testResult.details,
      });
    }

    if (type === 'redis') {
      const { redisUrl, hostName } = payload || {};
      let effectiveUrl = redisUrl !== undefined ? redisUrl.trim() : (getCurrentRedisUrl() || '');
      const effectiveHostName = (hostName !== undefined ? hostName : (process.env.REDIS_HOST_NAME || '')).trim();
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
      process.env.REDIS_URL = effectiveUrl;
      process.env.REDIS_HOST_NAME = effectiveHostName;
      updateEnvVariable('REDIS_URL', effectiveUrl);
      updateEnvVariable('REDIS_HOST_NAME', effectiveHostName);

      await SystemConfig.findOneAndUpdate(
        { key: 'redis' },
        {
          key: 'redis',
          config: { redisUrl: effectiveUrl, hostName: effectiveHostName },
          lastStatus: effectiveUrl ? 'connected' : 'fallback',
          lastMessage: effectiveUrl ? 'Redis active' : 'Running in memory fallback mode',
          lastTestedAt: new Date(),
          latencyMs: testDetails ? testDetails.latencyMs : 0,
          updatedBy: req.user?._id,
        },
        { upsert: true, returnDocument: 'after' }
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
      if (user) updateEnvVariable('EMAIL_USER', user);
      if (pass) updateEnvVariable('EMAIL_PASS', pass);

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
        { upsert: true, returnDocument: 'after' }
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

/**
 * 4. Get Email Queue Items & DLQ Metrics
 */
export const getEmailQueue = async (req, res) => {
  try {
    const { limit = 50, status } = req.query;
    const stats = await getEmailQueueStats({ limit: Number(limit) || 50, status });
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('getEmailQueue error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Manually Trigger Email Queue Worker Flush
 */
export const flushEmailQueueHandler = async (req, res) => {
  try {
    const result = await flushEmailQueue();
    const stats = await getEmailQueueStats({ limit: 50 });
    return res.status(200).json({
      success: true,
      message: result.message || 'Email queue flush completed.',
      result,
      data: stats,
    });
  } catch (error) {
    console.error('flushEmailQueueHandler error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Retry a specific Failed / Pending Email Job
 */
export const retryEmailJobHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await retryFailedEmailJob(id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('retryEmailJobHandler error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Bulk Retry All Dead Letter Queue (DLQ) Failed Emails
 */
export const retryAllFailedEmailsHandler = async (req, res) => {
  try {
    const result = await retryAllFailedJobs();
    return res.status(200).json(result);
  } catch (error) {
    console.error('retryAllFailedEmailsHandler error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 8. Delete an Email Job from Queue
 */
export const deleteEmailJobHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteEmailQueueJob(id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('deleteEmailJobHandler error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
