import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ChecklistItem,
  missingEnv,
  PROVIDER_CHECKLISTS,
  type ProviderMode,
  providerMode,
} from './providers/config.ts';
import { REAL_PROVIDERS, type RealProvider } from './providers/types.ts';

/**
 * Provider health (M3.5b): counters per provider and UTC hour in the platform table
 * `notifications.provider_health`, written through a SECURITY DEFINER function outside any
 * tenant transaction (so a busy hour row never serializes orgs), read by staff through
 * platform_reader (the staff console writes the access log first).
 */
export type HealthKind = 'send' | 'send_error' | 'webhook' | 'webhook_rejected';

export interface HealthTick {
  readonly provider: string;
  readonly kind: HealthKind;
  /** A short error code (never an address, body or id). */
  readonly error?: string | null;
}

const PROVIDER_RE = /^[a-z0-9_-]{1,32}$/;

/** Record counts (after the tenant transaction committed). Failures never break a send. */
export async function recordProviderHealth(ticks: readonly HealthTick[]): Promise<void> {
  const valid = ticks.filter((t) => PROVIDER_RE.test(t.provider));
  if (valid.length === 0) return;
  try {
    await withoutTenant(async (tx) => {
      for (const t of valid)
        await tx.execute(
          sql`select notifications.record_provider_health(${t.provider}, ${t.kind}, ${t.error?.slice(0, 100) ?? null})`,
        );
    });
  } catch (err) {
    console.error(JSON.stringify({ providerHealth: 'record failed', error: String(err).slice(0, 200) }));
  }
}

export const ProviderHealthDto = z.object({
  provider: z.string(),
  real: z.boolean(),
  mode: z.enum(['live', 'ready', 'off', 'fake']),
  lastWebhookAt: z.date().nullable(),
  sends24h: z.int(),
  sendErrors24h: z.int(),
  /** Send errors ÷ attempts over 24 hours, in basis points; null without attempts. */
  errorRateBps: z.int().nullable(),
  webhooks24h: z.int(),
  webhooksRejected24h: z.int(),
  lastError: z.string().nullable(),
  lastErrorAt: z.date().nullable(),
  /** Config names still missing (names only). */
  missing: z.array(z.string()),
  checklist: z.array(
    z.object({
      id: z.string(),
      check: z.enum(['owner', 'env', 'webhook', 'switch']),
      done: z.boolean().nullable(),
    }),
  ),
});
export type ProviderHealthDto = z.infer<typeof ProviderHealthDto>;

type HealthRow = {
  provider: string;
  last_webhook_at: Date | string | null;
  sends: number;
  send_errors: number;
  webhooks: number;
  webhooks_rejected: number;
  last_error: string | null;
  last_error_at: Date | string | null;
};

const date = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v : new Date(v));

/** Staff console: every real provider (and the dev fakes that reported), inside platform_reader. */
export async function providerHealthTx(
  tx: TenantTx,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = new Date(),
): Promise<ProviderHealthDto[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const rows = await tx.execute<HealthRow>(sql`
    select provider,
      max(last_webhook_at) as last_webhook_at,
      coalesce(sum(sends) filter (where hour >= ${since}::timestamptz), 0)::int as sends,
      coalesce(sum(send_errors) filter (where hour >= ${since}::timestamptz), 0)::int as send_errors,
      coalesce(sum(webhooks) filter (where hour >= ${since}::timestamptz), 0)::int as webhooks,
      coalesce(sum(webhooks_rejected) filter (where hour >= ${since}::timestamptz), 0)::int as webhooks_rejected,
      (array_agg(last_error order by last_error_at desc nulls last))[1] as last_error,
      max(last_error_at) as last_error_at
    from notifications.provider_health
    group by provider
    order by provider`);
  const byProvider = new Map([...rows].map((r) => [r.provider, r]));
  const providers = [
    ...REAL_PROVIDERS,
    ...[...byProvider.keys()].filter((p) => !(REAL_PROVIDERS as readonly string[]).includes(p)).sort(),
  ];
  return providers.map((provider) => {
    const r = byProvider.get(provider);
    const real = (REAL_PROVIDERS as readonly string[]).includes(provider);
    const mode: ProviderHealthDto['mode'] = real ? providerMode(provider as RealProvider, env) : 'fake';
    const sends = r?.sends ?? 0;
    const errors = r?.send_errors ?? 0;
    const lastWebhookAt = date(r?.last_webhook_at ?? null);
    const missing = real ? missingEnv(provider as RealProvider, env) : [];
    const checklist = real
      ? PROVIDER_CHECKLISTS[provider as RealProvider].map((item: ChecklistItem) => ({
          id: item.id,
          check: item.check,
          done:
            item.check === 'owner'
              ? null
              : item.check === 'env'
                ? missing.length === 0
                : item.check === 'webhook'
                  ? lastWebhookAt !== null
                  : mode === ('live' satisfies ProviderMode),
        }))
      : [];
    return ProviderHealthDto.parse({
      provider,
      real,
      mode,
      lastWebhookAt,
      sends24h: sends,
      sendErrors24h: errors,
      errorRateBps: sends + errors > 0 ? Math.round((errors / (sends + errors)) * 10_000) : null,
      webhooks24h: r?.webhooks ?? 0,
      webhooksRejected24h: r?.webhooks_rejected ?? 0,
      lastError: r?.last_error ?? null,
      lastErrorAt: date(r?.last_error_at ?? null),
      missing,
      checklist,
    });
  });
}
