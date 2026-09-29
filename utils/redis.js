import Redis from 'ioredis';

let redisClient = null;
let isConnected = false;
let currentRedisUrl = process.env.REDIS_URL || '';

export const resolveRedisConfig = (rawUrl) => {
  if (!rawUrl || !rawUrl.trim()) return null;

  let url = rawUrl.trim();
  const isUpstash = url.includes('upstash.io');
  const isCloud =
    url.includes('redislabs.com') ||
    url.includes('redis.cache.windows.net') ||
    url.includes('amazonaws.com') ||
    url.includes('aivencloud.com');
  const isExplicitTls = url.startsWith('rediss://');

  if ((isUpstash || isCloud) && url.startsWith('redis://')) {
    url = url.replace(/^redis:\/\//, 'rediss://');
  }

  const needsTls = isExplicitTls || isUpstash || isCloud;

  return {
    url,
    needsTls,
    options: {
      maxRetriesPerRequest: 3,
      connectTimeout: 8000,
      lazyConnect: false,
      enableOfflineQueue: false,
      tls: needsTls ? { rejectUnauthorized: false } : undefined,
      retryStrategy(times) {
        if (times > 3) {
          console.warn('[Redis] Max reconnection attempts reached. Continuing with in-memory fallback.');
          return null;
        }
        return Math.min(times * 500, 2000);
      },
    },
  };
};

export const initRedisClient = (url = currentRedisUrl) => {
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (_) {}
    redisClient = null;
    isConnected = false;
  }

  currentRedisUrl = url;
  const config = resolveRedisConfig(url);

  if (config) {
    try {
      redisClient = new Redis(config.url, config.options);

      redisClient.on('connect', () => {
        console.log('[Redis] Connected to Redis instance');
        isConnected = true;
      });

      redisClient.on('ready', () => {
        console.log('[Redis] Redis client ready for operations');
        isConnected = true;
      });

      redisClient.on('error', (err) => {
        console.warn('[Redis] Connection warning/error:', err.message);
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

// Initial connection
initRedisClient(currentRedisUrl);

export const testRedisConnection = async (testUrl) => {
  const targetUrl = testUrl || currentRedisUrl;
  if (!targetUrl || !targetUrl.trim()) {
    return {
      success: true,
      message: 'Redis is not configured. Platform is running in in-memory fallback mode.',
      latencyMs: 0,
      mode: 'In-Memory Fallback',
    };
  }

  const config = resolveRedisConfig(targetUrl);
  const startTime = Date.now();

  const attemptConnect = async (urlToTry, useTls) => {
    const tempClient = new Redis(urlToTry, {
      maxRetriesPerRequest: 1,
      connectTimeout: 6000,
      lazyConnect: true,
      enableOfflineQueue: false,
      tls: useTls ? { rejectUnauthorized: false } : undefined,
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
        message: `Redis connection verified successfully (${pingResponse}).`,
        latencyMs,
        normalizedUrl: urlToTry,
        details: {
          status: 'Connected & Ready',
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
    // Primary attempt
    return await attemptConnect(config.url, config.needsTls);
  } catch (primaryErr) {
    // If TLS was false, retry once with TLS in case cloud provider requires it
    if (!config.needsTls) {
      try {
        const tlsUrl = config.url.replace(/^redis:\/\//, 'rediss://');
        return await attemptConnect(tlsUrl, true);
      } catch (_) {}
    }

    return {
      success: false,
      message: `Redis connection failed: ${primaryErr.message}`,
      latencyMs: Date.now() - startTime,
    };
  }
};

export const isRedisReady = () => Boolean(redisClient && isConnected);
export const getRedisClient = () => (isRedisReady() ? redisClient : null);
export const getCurrentRedisUrl = () => currentRedisUrl;

export default redisClient;


