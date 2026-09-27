import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { and, eq, lt, sql } from 'drizzle-orm';
import { rateLimits } from './schema.ts';

export interface RateLimitRule {
  /** What is counted, e.g. `seat-finder:<eventId>:<device hash>`. Never raw personal data. */
  readonly bucket: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Requests counted in this window, including this one. */
  readonly hits: number;
  readonly remaining: number;
  readonly resetAt: Date;
}

/** The start of the fixed window containing `now`. */
export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Windows older than this are pruned when a new request is counted. */
const KEEP_MS = 24 * 3_600_000;

/**
 * Count one request against a fixed-window limit, inside the caller's tenant transaction (the
 * count commits with it, so callers must not throw after an over-limit answer if the hit should
 * stick). Concurrent requests serialise on the window's row: the count is exact.
 */
export async function hitRateLimitTx(tx: TenantTx, ctx: Ctx, rule: RateLimitRule): Promise<RateLimitResult> {
  const orgId = requireOrg(ctx);
  const start = windowStart(ctx.now, rule.windowMs);
  const [row] = await tx
    .insert(rateLimits)
    .values({ orgId, bucket: rule.bucket, windowStart: start, hits: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.orgId, rateLimits.bucket, rateLimits.windowStart],
      set: { hits: sql`${rateLimits.hits} + 1`, updatedAt: ctx.now },
    })
    .returning({ hits: rateLimits.hits });
  await tx
    .delete(rateLimits)
    .where(and(eq(rateLimits.orgId, orgId), lt(rateLimits.windowStart, new Date(start.getTime() - KEEP_MS))));
  const hits = row?.hits ?? 1;
  return {
    allowed: hits <= rule.limit,
    hits,
    remaining: Math.max(0, rule.limit - hits),
    resetAt: new Date(start.getTime() + rule.windowMs),
  };
}
