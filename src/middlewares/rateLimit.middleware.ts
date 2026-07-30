import { rateLimit } from 'express-rate-limit';
import type { Request } from 'express';

export const loginRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 7,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

export const registerRateLimitMiddleware = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

export const activationIpRateLimitMiddleware = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 7,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

export const activationEmailRateLimitMiddleware = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 3, // Limit each email to 3 requests per `window` (here, per 24 hours).
  keyGenerator: (req: Request) => req.body?.resendActivationData?.email || req.ip,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

export const passwordResetIpRateLimitMiddleware = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 7,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});

export const passwordResetEmailRateLimitMiddleware = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 3, // Limit each email to 3 reset requests per 24 hours.
  keyGenerator: (req: Request) => req.body?.resetPasswordData?.email || req.ip,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
});
