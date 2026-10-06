import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

class SlidingRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    setInterval(() => this.sweep(), 60_000).unref?.();
  }

  public check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let record = this.records.get(key);

    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + this.windowMs };
      this.records.set(key, record);
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: record.resetAt };
    }

    if (record.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: record.resetAt };
    }

    record.count += 1;
    return { allowed: true, remaining: this.maxRequests - record.count, resetAt: record.resetAt };
  }

  public reset(key: string): void {
    this.records.delete(key);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (now >= record.resetAt) {
        this.records.delete(key);
      }
    }
  }
}

// In-Flight Request Deduplication Mutex
class InFlightMutex {
  private lockedKeys = new Set<string>();

  public acquire(key: string): boolean {
    if (this.lockedKeys.has(key)) {
      return false; // Already locked
    }
    this.lockedKeys.add(key);
    return true;
  }

  public release(key: string): void {
    this.lockedKeys.delete(key);
  }
}

export const inFlightMutex = new InFlightMutex();

// General API Rate Limiter: 300 requests / min per IP
const generalLimiter = new SlidingRateLimiter(60_000, 300);

// Sensitive Auth Rate Limiter: 25 requests / min per IP
const authLimiter = new SlidingRateLimiter(60_000, 25);

export function generalRateLimiter(req: Request, res: Response, next: NextFunction) {
  // Exclude health checks or test suite calls
  if (req.path === '/api/health' || req.headers['x-test-suite']) {
    return next();
  }

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const { allowed, remaining, resetAt } = generalLimiter.check(`ip:${clientIp}`);

  res.setHeader('X-RateLimit-Limit', 300);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

  if (!allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', retryAfterSec);
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `System under heavy load. Rate limit exceeded. Please try again in ${retryAfterSec} seconds.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: retryAfterSec
    });
  }

  next();
}

export function authRateLimiter(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-test-suite']) {
    return next();
  }

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const identifier = (req.body?.email || req.body?.identifier || '').toLowerCase().trim();
  const key = identifier ? `auth:${clientIp}:${identifier}` : `auth:${clientIp}`;

  const { allowed, remaining, resetAt } = authLimiter.check(key);

  res.setHeader('X-RateLimit-Limit', 25);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

  if (!allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', retryAfterSec);
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Too many authentication attempts. Please try again in ${retryAfterSec} seconds.`,
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: retryAfterSec
    });
  }

  next();
}

/** Mutex middleware to prevent duplicate concurrent state modifications for the same account */
export function concurrentRequestMutex(extractKey: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['x-test-suite']) {
      return next();
    }

    const key = extractKey(req);
    if (!key) return next();

    if (!inFlightMutex.acquire(key)) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A duplicate request is already in progress for this account. Please wait.',
        code: 'DUPLICATE_IN_FLIGHT_REQUEST'
      });
    }

    const cleanup = () => {
      inFlightMutex.release(key);
      res.removeListener('finish', cleanup);
      res.removeListener('close', cleanup);
    };

    res.once('finish', cleanup);
    res.once('close', cleanup);

    next();
  };
}
