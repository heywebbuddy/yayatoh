export interface RateDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the bucket is full again (RateLimit-Reset) or, when refused, until one token. */
  readonly resetSeconds: number;
}

/**
 * Token buckets keyed by credential (roadmap §6.1). Production swaps in the Upstash adapter
 * (owner account pending); this in-memory one serves dev, tests and a single instance.
 */
export interface RateLimiter {
  take(key: string, limit: number, windowSeconds: number, now?: number): RateDecision;
}

interface Bucket {
  tokens: number;
  at: number;
}

export function memoryRateLimiter(opts: { maxKeys?: number; clock?: () => number } = {}): RateLimiter {
  const maxKeys = opts.maxKeys ?? 50_000;
  const clock = opts.clock ?? Date.now;
  const buckets = new Map<string, Bucket>();
  return {
    take(key, limit, windowSeconds, now = clock()) {
      const perMs = limit / (windowSeconds * 1000);
      const b = buckets.get(key) ?? { tokens: limit, at: now };
      b.tokens = Math.min(limit, b.tokens + (now - b.at) * perMs);
      b.at = now;
      const allowed = b.tokens >= 1;
      if (allowed) b.tokens -= 1;
      buckets.delete(key);
      buckets.set(key, b);
      // Least-recently-used eviction keeps memory bounded.
      if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value as string);
      const remaining = Math.floor(b.tokens);
      const resetSeconds = allowed
        ? Math.ceil((limit - b.tokens) / perMs / 1000)
        : Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000));
      return { allowed, limit, remaining, resetSeconds };
    },
  };
}

/** Limits per scope (requests per window). Keyed by credential, never by IP alone, where one exists. */
export const RATE_LIMITS = {
  /** Per API key or per signed-in user. */
  credential: { limit: 600, window: 60 },
  /** Per test key (`yy_test_`): enough to build and test against, too little to run production on. */
  testKey: { limit: 120, window: 60 },
  /** Anonymous public reads, per client IP: generous, since venue Wi-Fi and CGNAT share IPs. */
  anonymous: { limit: 300, window: 60 },
  search: { limit: 60, window: 60 },
  loginAccount: { limit: 5, window: 15 * 60 },
  loginIp: { limit: 100, window: 60 },
} as const;
