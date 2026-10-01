import redisClient, { isRedisReady } from '../utils/redis.js';

/**
 * Enterprise Multi-Tenant Cache Service
 * Provides distributed caching, automatic JSON serialization,
 * and high-performance pattern invalidation via non-blocking SCAN.
 */
class CacheService {
  /**
   * Generates a standardized multi-tenant cache key.
   * Format: `cache:t:<brokerageId>:<domain>:<identifier>`
   */
  generateKey(brokerageId, domain, identifier = 'default') {
    const tenantPart = brokerageId ? `t:${brokerageId}` : 'global';
    const idPart = typeof identifier === 'object' ? JSON.stringify(identifier) : String(identifier);
    return `cache:${tenantPart}:${domain}:${idPart}`;
  }

  /**
   * Retrieves an item from Redis and deserializes JSON.
   * Returns null on cache miss or when Redis is offline.
   */
  async get(key) {
    if (!isRedisReady() || !redisClient) return null;

    try {
      const raw = await redisClient.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[CacheService] Error fetching key "${key}":`, err.message);
      return null;
    }
  }

  /**
   * Serializes and writes data to Redis with a TTL in seconds.
   */
  async set(key, value, ttlSeconds = 300) {
    if (!isRedisReady() || !redisClient) return false;

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await redisClient.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await redisClient.set(key, serialized);
      }
      return true;
    } catch (err) {
      console.warn(`[CacheService] Error saving key "${key}":`, err.message);
      return false;
    }
  }

  /**
   * Deletes a specific key or array of keys from Redis.
   */
  async del(...keys) {
    if (!isRedisReady() || !redisClient || keys.length === 0) return 0;

    try {
      const flatKeys = keys.flat().filter(Boolean);
      if (flatKeys.length === 0) return 0;
      return await redisClient.unlink(...flatKeys);
    } catch (err) {
      console.warn('[CacheService] Error deleting keys:', err.message);
      return 0;
    }
  }

  /**
   * Non-blocking invalidation of all keys matching a wildcard pattern.
   * Uses Redis SCAN to iterate safely without blocking the event loop.
   */
  async invalidatePattern(pattern) {
    if (!isRedisReady() || !redisClient || !pattern) return 0;

    try {
      let cursor = '0';
      let totalDeleted = 0;

      do {
        const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys && keys.length > 0) {
          const count = await redisClient.unlink(...keys);
          totalDeleted += count;
        }
      } while (cursor !== '0');

      return totalDeleted;
    } catch (err) {
      console.warn(`[CacheService] Error invalidating pattern "${pattern}":`, err.message);
      return 0;
    }
  }

  /**
   * Invalidates all cached entities for an entire brokerage tenant.
   */
  async invalidateTenant(brokerageId) {
    if (!brokerageId) return 0;
    const pattern = `cache:t:${brokerageId}:*`;
    return await this.invalidatePattern(pattern);
  }

  /**
   * Cache-Aside Helper:
   * 1. Checks Redis for existing cached value.
   * 2. If present, returns cached value immediately.
   * 3. If cache miss, executes `fetcherFn()`, caches the fresh result, and returns it.
   */
  async remember(key, ttlSeconds, fetcherFn) {
    const cached = await this.get(key);
    if (cached !== null && cached !== undefined) {
      return { data: cached, isCached: true };
    }

    const freshData = await fetcherFn();
    if (freshData !== null && freshData !== undefined) {
      // Async write to Redis (non-blocking)
      this.set(key, freshData, ttlSeconds).catch(() => {});
    }

    return { data: freshData, isCached: false };
  }
}

export const cacheService = new CacheService();
export default cacheService;
