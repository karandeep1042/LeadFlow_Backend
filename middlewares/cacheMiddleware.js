import cacheService from '../services/cacheService.js';

/**
 * Route-level caching middleware.
 * Caches JSON responses for GET requests matching tenant and query filters.
 */
export const cacheResponse = (ttlSeconds = 300, domain = 'api') => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const brokerageId = req.user?.brokerageId || req.tenantId || 'global';
    const role = req.user?.role || 'anon';
    const userId = req.user?._id || 'anon';

    // Normalize and sort query params to ensure consistent cache keys
    const sortedQuery = Object.keys(req.query || {})
      .sort()
      .reduce((acc, key) => {
        acc[key] = req.query[key];
        return acc;
      }, {});

    const identifier = `${role}:${userId}:${req.baseUrl}${req.path}:${JSON.stringify(sortedQuery)}`;
    const cacheKey = cacheService.generateKey(brokerageId, domain, identifier);

    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json(cached);
      }

      // Intercept res.json to capture response and write to Redis
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && body) {
          cacheService.set(cacheKey, body, ttlSeconds).catch(() => {});
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      return next();
    } catch (err) {
      console.warn('[CacheMiddleware] Error in cacheResponse middleware:', err.message);
      return next();
    }
  };
};
