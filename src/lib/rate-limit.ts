/**
 * In-memory token-bucket rate limiter.
 *
 * Per-instance only: counters live in a process-local Map, so horizontal
 * scale-out will need a Redis-backed replacement (each instance enforces its
 * own slice of the limit otherwise). Fine for single-instance Railway/Vercel
 * serverless deploys where a small over-allow on cold-start hand-off is
 * acceptable.
 *
 * The Map is size-capped with LRU eviction (oldest inserted entry dropped)
 * so a flood of unique IPs can't grow memory without bound. We rely on Map's
 * insertion-order iteration: on every hit we delete + re-insert the key,
 * promoting it to "most recently used" (the last key in iteration order).
 * Eviction pops the first key, which is the least recently used.
 *
 * Each bucket is a classic token bucket: `limit` tokens refilled at
 * `limit / windowSeconds` tokens per second. Requests consume one token; if
 * tokens < 1 the request is denied and `retryAfterSeconds` reports when the
 * next whole token becomes available.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

type Bucket = {
  tokens: number;
  updatedAt: number; // ms epoch
  limit: number;
  refillPerMs: number;
};

const MAX_ENTRIES = 10_000;
const buckets = new Map<string, Bucket>();

function touch(key: string, bucket: Bucket): void {
  // Promote to MRU: delete-then-set rewrites insertion order.
  buckets.delete(key);
  buckets.set(key, bucket);
  if (buckets.size > MAX_ENTRIES) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): RateLimitResult {
  const { limit, windowSeconds } = opts;
  const now = Date.now();
  const refillPerMs = limit / (windowSeconds * 1000);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit, updatedAt: now, limit, refillPerMs };
  } else {
    const elapsed = now - bucket.updatedAt;
    bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;
    // Re-sync in case caller changed the window for the same key — unlikely in
    // practice but cheap and keeps behaviour deterministic.
    bucket.limit = limit;
    bucket.refillPerMs = refillPerMs;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    touch(key, bucket);
    return { allowed: true };
  }

  // Not enough tokens: how long until one token has regenerated?
  const deficit = 1 - bucket.tokens;
  const waitMs = Math.ceil(deficit / refillPerMs);
  touch(key, bucket);
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
  };
}

/**
 * Derive a stable key from (bucket, client IP). We trust the first value in
 * x-forwarded-for because Railway/Vercel append the real client IP at the
 * left-most position. If the header is missing we fall back to "unknown",
 * which means all unknown-IP traffic shares a single bucket — a deliberate
 * choice so a proxy misconfig fails closed rather than disabling the limit.
 */
export function rateLimitKey(req: Request, bucket: string): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || "unknown";
  return `${bucket}:${ip}`;
}
