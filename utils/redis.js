import './dotenvLoader.js';
import Redis from 'ioredis';

let redisClient = null;
let isConnected = false;
let currentRedisUrl = process.env.REDIS_URL || '';

/**
 * Resolves configuration parameters for ioredis instance.
 * Automatically enables TLS & SNI for Upstash and cloud-hosted clusters.
 */
export const resolveRedisConfig = (rawUrl) => {
  const urlToParse = (rawUrl || currentRedisUrl || process.env.REDIS_URL || '').trim();
  if (!urlToParse) return null;

  let url = urlToParse;
  const isUpstash = url.includes('upstash.io');
  const isCloud =
    url.includes('redislabs.com') ||
    url.includes('redis.cache.windows.net') ||
    url.includes('amazonaws.com') ||
    url.includes('aivencloud.com') ||
    isUpstash;
  const isExplicitTls = url.startsWith('rediss://');

  if ((isUpstash || isCloud) && url.startsWith('redis://')) {
    url = url.replace(/^redis:\/\//, 'rediss://');
  }

  const needsTls = isExplicitTls || isUpstash || isCloud;

  let host = '127.0.0.1';
  let port = 6379;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || '127.0.0.1';
    port = parsed.port ? parseInt(parsed.port, 10) : 6379;
  } catch (_) {}

  return {
    url,
    host,
    port,
    isUpstash,
    isCloud,
    needsTls,
    options: {
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      keepAlive: 10000,
      lazyConnect: false,
      enableOfflineQueue: true,
      tls: needsTls ? { rejectUnauthorized: false, servername: host } : undefined,
      retryStrategy(times) {
        // Continuous backoff up to 3 seconds to ensure automatic recovery after idle timeouts
        return Math.min(times * 500, 3000);
      },
      reconnectOnError(err) {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'Connection is closed'];
        if (targetErrors.some((t) => (err?.message || '').includes(t))) {
          return true; // Reconnect automatically
        }
        return false;
      },
    },
  };
};

/**
 * Initializes or re-initializes the global Redis client.
 */
export const initRedisClient = (url = process.env.REDIS_URL || currentRedisUrl) => {
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (_) {}
    redisClient = null;
    isConnected = false;
  }

  currentRedisUrl = (url || '').trim();
  const config = resolveRedisConfig(currentRedisUrl);

  if (config) {
    try {
      redisClient = new Redis(config.url, config.options);

      redisClient.on('connect', () => {
        console.log(`[Redis] Connected to Redis instance at ${config.host}:${config.port}`);
        isConnected = true;
      });

      redisClient.on('ready', () => {
        console.log(`[Redis] Redis client ready for operations (${config.host})`);
        isConnected = true;
      });

      redisClient.on('error', (err) => {
        console.warn(`[Redis] Connection warning (${config.host}):`, err.message);
        isConnected = false;
      });

      redisClient.on('close', () => {
        isConnected = false;
      });
    } catch (err) {
      console.error('[Redis] Initialization error:', err.message);
      redisClient = null;
      isConnected = false;
    }
  } else {
    console.log('[Redis] REDIS_URL not configured. Running in memory fallback mode.');
  }

  return redisClient;
};

// Initial connection attempt on boot
initRedisClient(currentRedisUrl || process.env.REDIS_URL || '');

/**
 * Non-destructive connection test for a given Redis URL or the current active connection.
 */
export const testRedisConnection = async (testUrl) => {
  const targetUrl = (testUrl || currentRedisUrl || process.env.REDIS_URL || '').trim();
  if (!targetUrl) {
    return {
      success: true,
      message: 'Redis is not configured. Platform is running in in-memory fallback mode.',
      latencyMs: 0,
      mode: 'In-Memory Fallback',
    };
  }

  const config = resolveRedisConfig(targetUrl);
  const startTime = Date.now();

  const attemptConnect = async (urlToTry, useTls, host) => {
    const tempClient = new Redis(urlToTry, {
      maxRetriesPerRequest: 1,
      connectTimeout: 6000,
      lazyConnect: true,
      enableOfflineQueue: false,
      tls: useTls ? { rejectUnauthorized: false, servername: host } : undefined,
    });

    try {
      await tempClient.connect();
      const pingResponse = await tempClient.ping();
      const latencyMs = Date.now() - startTime;
      let keyCount = 0;
      try {
        keyCount = await tempClient.dbsize();
      } catch (_) {}
      await tempClient.quit();

      return {
        success: true,
        message: `Redis connection verified successfully (${pingResponse}). Host: ${host}`,
        latencyMs,
        normalizedUrl: urlToTry,
        details: {
          status: 'Connected & Ready',
          host,
          pingResponse,
          keyCount,
          tls: useTls,
        },
      };
    } catch (err) {
      try {
        tempClient.disconnect();
      } catch (_) {}
      throw err;
    }
  };

  try {
    return await attemptConnect(config.url, config.needsTls, config.host);
  } catch (primaryErr) {
    // If TLS was not set, retry once with TLS in case cloud provider requires it
    if (!config.needsTls) {
      try {
        const tlsUrl = config.url.replace(/^redis:\/\//, 'rediss://');
        return await attemptConnect(tlsUrl, true, config.host);
      } catch (_) {}
    }

    return {
      success: false,
      message: `Redis connection failed: ${primaryErr.message}`,
      latencyMs: Date.now() - startTime,
    };
  }
};

export const isRedisReady = () => {
  if (!redisClient) return false;
  return isConnected && (redisClient.status === 'ready' || redisClient.status === 'connect');
};
export const getRedisClient = () => redisClient;
export const getCurrentRedisUrl = () => currentRedisUrl || process.env.REDIS_URL || '';

export const getRedisHost = () => {
  const url = getCurrentRedisUrl();
  if (!url) return 'In-Memory';
  try {
    const parsed = new URL(url);
    return parsed.hostname || 'Redis Instance';
  } catch (_) {
    return 'Redis Instance';
  }
};

export default redisClient;



