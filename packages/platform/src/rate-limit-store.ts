import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import type { RateLimitStore } from './security/rate-limit.ts';

/**
 * Rate-limit counters in Postgres (`platform.rate_limit_hit`, SECURITY DEFINER, atomic per key)
 * until the owner's Upstash Redis exists. Runs as app_user with no tenant.
 */
export const postgresRateLimitStore: RateLimitStore = {
  async hit(key, rule, now) {
    const rows = await withoutTenant((tx) =>
      tx.execute<{ allowed: boolean; remaining: number; retry_after_ms: number }>(
        sql`select allowed, remaining, retry_after_ms from platform.rate_limit_hit(${key}, ${rule.limit}, ${rule.windowMs}, ${Math.floor(now)})`,
      ),
    );
    const r = rows[0];
    if (!r) throw new Error('rate_limit_hit returned nothing');
    return { allowed: r.allowed, limit: rule.limit, remaining: r.remaining, retryAfterMs: r.retry_after_ms };
  },
};

/** Drop expired counters (retention job). */
export async function purgeRateLimits(): Promise<number> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ n: number }>(sql`select platform.purge_rate_limits() as n`),
  );
  return rows[0]?.n ?? 0;
}
