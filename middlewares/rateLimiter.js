import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redisClient from '../utils/redis.js';

/**
 * Creates a rate limiter instance backed by Redis if available, or in-memory store as fallback.
 */
export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = 'Too many requests. Please try again later.',
  prefix = 'global',
  skipSuccessfulRequests = false,
  skipFailedRequests = false,
  keyGenerator,
} = {}) => {
  let store;
  if (redisClient) {
    try {
      store = new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: `rl:${prefix}:`,
      });
    } catch (err) {
      console.warn(`[RateLimiter] Error initializing RedisStore for prefix "${prefix}", falling back to memory:`, err.message);
    }
  }

  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true, // draft-6 / draft-7 RateLimit headers
    legacyHeaders: false, // disable X-RateLimit headers
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator,
    store,
    handler: (req, res, next, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      res.status(options.statusCode || 429).json({
        success: false,
        error: options.message || message,
        retryAfter,
      });
    },
  });
};

/**
 * 1. Auth Limiter (Login & Brokerage Registration)
 * Strict limit to mitigate brute-force and credential stuffing attacks.
 * Limit: 10 attempts per 15 minutes per IP
 */
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  prefix: 'auth',
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

/**
 * 2. Password Reset Request Limiter
 * Protects against email flooding / SMTP quota exhaustion.
 * Limit: 5 requests per 15 minutes per IP
 */
export const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  prefix: 'pw_reset',
  message: 'Too many password reset requests. Please try again in 15 minutes.',
});

/**
 * 3. OTP / Reset Code Verification Limiter
 * Protects 6-digit numeric reset codes against brute-force enumeration.
 * Limit: 5 verification attempts per 15 minutes per IP
 */
export const verifyResetCodeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  prefix: 'otp_verify',
  message: 'Too many verification code attempts. Please request a new code and try again.',
});

/**
 * 4. Inbound Webhook Ingestion Limiter
 * Limits public portal webhook leads (e.g., ImmoScout24, Immowelt, Typeform) from flooding the lead pool.
 * Limit: 60 requests per 1 minute per IP
 */
export const webhookLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 60,
  prefix: 'webhook',
  message: 'Inbound webhook ingestion rate limit exceeded. Please throttle request frequency.',
});

/**
 * 5. Document & File Upload Limiter
 * Protects against storage exhaustion and memory/bandwidth overload.
 * Limit: 30 uploads per 10 minutes per IP
 */
export const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  prefix: 'doc_upload',
  message: 'Document upload rate limit reached. Please wait a few minutes before uploading more files.',
});

/**
 * 6. Global Baseline API Protection
 * Protects all /api endpoints against automated scraping and DoS spikes.
 * Limit: 300 requests per 1 minute per IP
 */
export const globalApiLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 300,
  prefix: 'global_api',
  message: 'Too many requests sent to the server. Please slow down.',
});
