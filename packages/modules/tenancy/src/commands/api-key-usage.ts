import { withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiKeys, apiKeyUsageDaily } from '../schema.ts';

/**
 * M6.3a: one /v1 request made with an org API key, counted per key and per day of the org's
 * timezone. Errors are responses with a status ≥ 400; `rateLimited` counts the 429s among them.
 * Runs under the key's org RLS as a system actor.
 */
export async function recordApiKeyUsage(u: { orgId: string; keyId: string; status: number }): Promise<void> {
  const errors = u.status >= 400 ? 1 : 0;
  const limited = u.status === 429 ? 1 : 0;
  const ctx = createCtx({ orgId: u.orgId, actor: { type: 'system', name: 'api-key-usage' } });
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      insert into tenancy.api_key_usage_daily as d (org_id, api_key_id, day, requests, errors, rate_limited)
      values (
        ${u.orgId}, ${u.keyId},
        (now() at time zone coalesce((select o.timezone from tenancy.organizations o where o.id = ${u.orgId}), 'UTC'))::date,
        1, ${errors}, ${limited}
      )
      on conflict (org_id, api_key_id, day) do update set
        requests = d.requests + 1,
        errors = d.errors + excluded.errors,
        rate_limited = d.rate_limited + excluded.rate_limited,
        updated_at = now()`),
  );
}

const Counts = z.object({ requests: z.int(), errors: z.int(), rateLimited: z.int() });

export const ApiUsageDto = z.object({
  /** The first and last day shown (the org's timezone, `YYYY-MM-DD`). */
  from: z.string(),
  to: z.string(),
  totals: Counts,
  /** Every day of the range, oldest first (days without requests count zero). */
  days: z.array(Counts.extend({ day: z.string() })),
  /** Keys with requests in the range, busiest first. */
  keys: z.array(
    Counts.extend({
      apiKeyId: z.uuid(),
      name: z.string(),
      prefix: z.string(),
      sandbox: z.boolean(),
      lastUsedAt: z.date().nullable(),
    }),
  ),
});
export type ApiUsageDto = z.infer<typeof ApiUsageDto>;

/** The org's "today" (its timezone) and the day `n` days before it. */
async function orgToday(tx: Parameters<Parameters<typeof withTenant>[1]>[0], orgId: string) {
  const [r] = await tx.execute<{ today: string }>(sql`
    select to_char((now() at time zone o.timezone)::date, 'YYYY-MM-DD') as today
    from tenancy.organizations o where o.id = ${orgId}`);
  return r?.today ?? new Date().toISOString().slice(0, 10);
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The usage page (M6.3a): requests and errors per day and per key over the last `days` days. */
export const apiUsageQuery = tenantQuery({
  name: 'tenancy.apiUsage',
  input: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
  output: ApiUsageDto,
  entitlement: 'core',
  permission: 'api_keys:manage',
  handler: async ({ input, ctx, tx }) => {
    const to = await orgToday(tx, requireOrg(ctx));
    const from = addDays(to, 1 - input.days);
    const rows = await tx
      .select()
      .from(apiKeyUsageDaily)
      .where(and(gte(apiKeyUsageDaily.day, from), sql`${apiKeyUsageDaily.day} <= ${to}`))
      .orderBy(asc(apiKeyUsageDaily.day));
    const byDay = new Map<string, { requests: number; errors: number; rateLimited: number }>();
    const byKey = new Map<string, { requests: number; errors: number; rateLimited: number }>();
    const totals = { requests: 0, errors: 0, rateLimited: 0 };
    for (const r of rows) {
      for (const [map, k] of [
        [byDay, r.day],
        [byKey, r.apiKeyId],
      ] as const) {
        const c = map.get(k) ?? { requests: 0, errors: 0, rateLimited: 0 };
        c.requests += r.requests;
        c.errors += r.errors;
        c.rateLimited += r.rateLimited;
        map.set(k, c);
      }
      totals.requests += r.requests;
      totals.errors += r.errors;
      totals.rateLimited += r.rateLimited;
    }
    const days = Array.from({ length: input.days }, (_, i) => {
      const day = addDays(from, i);
      return { day, ...(byDay.get(day) ?? { requests: 0, errors: 0, rateLimited: 0 }) };
    });
    const keyRows = byKey.size
      ? await tx
          .select({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            sandbox: apiKeys.sandbox,
            lastUsedAt: apiKeys.lastUsedAt,
          })
          .from(apiKeys)
          .orderBy(desc(apiKeys.createdAt))
      : [];
    const keys = keyRows
      .filter((k) => byKey.has(k.id))
      .map((k) => ({
        apiKeyId: k.id,
        name: k.name,
        prefix: k.prefix,
        sandbox: k.sandbox,
        lastUsedAt: k.lastUsedAt,
        ...(byKey.get(k.id) as { requests: number; errors: number; rateLimited: number }),
      }))
      .sort((a, b) => b.requests - a.requests);
    return { from, to, totals, days, keys };
  },
});

/**
 * The audit log's record of a key's use (M6.3a): one `apiKey.dailyUsage` entry per key and
 * finished day (the org's timezone), written once. The worker summarizes every past day hourly.
 */
export const summarizeApiKeyUsageCommand = tenantCommand({
  name: 'tenancy.summarizeApiKeyUsage',
  input: z.object({ apiKeyId: z.uuid(), day: z.iso.date() }),
  output: Counts.extend({ apiKeyId: z.uuid(), day: z.string() }),
  entitlement: null,
  permission: 'platform:api_usage.summarize',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(apiKeyUsageDaily)
      .set({ auditedAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(apiKeyUsageDaily.apiKeyId, input.apiKeyId),
          eq(apiKeyUsageDaily.day, input.day),
          isNull(apiKeyUsageDaily.auditedAt),
          lt(apiKeyUsageDaily.day, await orgToday(tx, requireOrg(ctx))),
        ),
      )
      .returning();
    if (!row) {
      const [exists] = await tx
        .select({ auditedAt: apiKeyUsageDaily.auditedAt })
        .from(apiKeyUsageDaily)
        .where(and(eq(apiKeyUsageDaily.apiKeyId, input.apiKeyId), eq(apiKeyUsageDaily.day, input.day)));
      if (!exists) throw new DomainError('not_found', 'No usage for this key and day');
      throw new DomainError('invalid_state', 'This day is not finished or was summarized already', {
        reason: exists.auditedAt ? 'already_summarized' : 'day_not_finished',
      });
    }
    return {
      apiKeyId: row.apiKeyId,
      day: row.day,
      requests: row.requests,
      errors: row.errors,
      rateLimited: row.rateLimited,
    };
  },
  audit: (_input, r) => ({
    action: 'apiKey.dailyUsage',
    targetType: 'api_key',
    targetId: r.apiKeyId,
    data: { day: r.day, count: r.requests, errors: r.errors, rateLimited: r.rateLimited },
  }),
});

/** The org's finished days not summarized in the audit log yet (oldest first). */
export async function unsummarizedApiKeyUsage(
  orgId: string,
  limit = 500,
): Promise<{ apiKeyId: string; day: string }[]> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'api-key-usage' } });
  return withTenant(ctx, async (tx) => {
    const today = await orgToday(tx, orgId);
    return tx
      .select({ apiKeyId: apiKeyUsageDaily.apiKeyId, day: apiKeyUsageDaily.day })
      .from(apiKeyUsageDaily)
      .where(and(isNull(apiKeyUsageDaily.auditedAt), lt(apiKeyUsageDaily.day, today)))
      .orderBy(asc(apiKeyUsageDaily.day))
      .limit(limit);
  });
}
