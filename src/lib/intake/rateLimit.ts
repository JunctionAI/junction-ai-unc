/* Per-key rate limit for POST /api/intake — fixed window, in process.

   One Next.js instance keeps one map; across instances the limit is per instance, which is
   the honest scope for a beta (a durable limiter belongs in the database when the intake
   volume justifies it). Defaults: 30 requests per 5 minutes per key. */

export const RATE_LIMIT_MAX = 30;
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(keyId: string, now = Date.now(), max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS): RateDecision {
  let b = buckets.get(keyId);
  if (!b || now - b.windowStart >= windowMs) {
    b = { windowStart: now, count: 0 };
    buckets.set(keyId, b);
  }
  if (b.count >= max) return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((b.windowStart + windowMs - now) / 1000)) };
  b.count += 1;
  // opportunistic sweep so the map cannot grow without bound
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.windowStart >= windowMs) buckets.delete(k);
  return { allowed: true, remaining: max - b.count, retryAfterSec: 0 };
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
