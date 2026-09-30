import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { type PaymentProvider, payoutAccountIdQuery, payoutAccountQuery } from '@yayatoh/payments';
import { createCommandPorts, postgresRateLimitStore } from '@yayatoh/platform';
import type { RateLimitStore } from '@yayatoh/platform/security';
import {
  type DomainProvider,
  orgAuthorizer,
  orgStatusGate,
  providerBackoffMs,
  RECHECK_MAX_AGE_MS,
  recheckDue,
  recordDomainCheckCommand,
  recordDomainWalletsCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

// The org gate (M1.3f) lets system actors through; wired for parity with the apps.
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});
const HOUR = 3_600_000;

/**
 * Provider calls the job may make per hour. Vercel's Domains API allows 100 adds an hour (M1.3d);
 * the job keeps well under it so organizers' own "Add" and "Check now" still have room.
 */
export const DEFAULT_CHECKS_PER_HOUR = 60;

export interface DomainRecheckDeps {
  readonly provider: DomainProvider;
  /** Registers Apple Pay / Google Pay once a host is active (skipped when absent). */
  readonly payments?: Pick<PaymentProvider, 'registerPaymentMethodDomain'> | null;
  /** Where the hourly budget is counted (Postgres by default, shared by every worker). */
  readonly store?: RateLimitStore;
  readonly limitPerHour?: number;
  /** At most this many domains per run. */
  readonly batch?: number;
  readonly now?: Date;
  /** Only these orgs (tests and the e2e hook); every org otherwise. */
  readonly orgIds?: readonly string[];
}

export interface DomainRecheckRun {
  /** Pending domains due for a check. */
  readonly due: number;
  readonly checked: number;
  readonly activated: number;
  /** Provider errors (the run stops at the first one). */
  readonly failed: number;
  /** The hourly budget ran out (the run stops). */
  readonly rateLimited: boolean;
  /** When the budget frees up again (ms), if it ran out. */
  readonly retryAfterMs: number;
}

type Candidate = {
  org_id: string;
  id: string;
  hostname: string;
  created_at: string;
  last_checked_at: string | null;
};

/** Register wallets on the platform account, and on the org's connected account once active. */
async function registerWallets(
  payments: Pick<PaymentProvider, 'registerPaymentMethodDomain'>,
  ctx: ReturnType<typeof createCtx>,
  domainId: string,
  hostname: string,
) {
  const pmd = await payments.registerPaymentMethodDomain({ hostname, accountId: null });
  const payout = await executeQuery(payoutAccountQuery, {}, ctx, ports);
  if (payout.state === 'active') {
    const { accountId } = await executeQuery(payoutAccountIdQuery, {}, ctx, ports);
    if (accountId) await payments.registerPaymentMethodDomain({ hostname, accountId });
  }
  await executeCommand(recordDomainWalletsCommand, { domainId, paymentMethodDomainId: pmd.id }, ctx, ports);
}

/**
 * Check pending custom domains again through the domain provider (M1.3f; leader only), so a
 * domain goes from pending to active without anyone pressing "Check now". Each org's domain is
 * recorded through `tenancy.recordDomainCheck` as a system actor in that org's own transaction:
 * the same command as "Check now", so activation, primary takeover and `domain.activated@1`
 * happen exactly once whoever checks first (idempotent). Domains are listed through
 * platform_reader (audited), only for live orgs, oldest check first, on the age-based schedule
 * (`recheckDue`), within an hourly provider budget.
 */
export async function recheckPendingDomains(deps: DomainRecheckDeps): Promise<DomainRecheckRun> {
  const now = deps.now ?? new Date();
  const limit = deps.limitPerHour ?? (Number(process.env.DOMAIN_CHECKS_PER_HOUR) || DEFAULT_CHECKS_PER_HOUR);
  const store = deps.store ?? postgresRateLimitStore;
  const since = new Date(now.getTime() - RECHECK_MAX_AGE_MS).toISOString();
  const rows = await withPlatformReader(
    { actor: 'system:domains.recheck', reason: 'list pending custom domains to check again' },
    (tx) =>
      tx.execute<Candidate>(sql`
        select d.org_id, d.id, d.hostname, d.created_at, d.last_checked_at
        from tenancy.org_domains d
        join tenancy.organizations o on o.id = d.org_id and o.status in ('active', 'limited')
        where not d.managed and d.status in ('pending_dns', 'verifying')
          and d.created_at > ${since}::timestamptz
          ${deps.orgIds ? sql`and d.org_id = any(${`{${deps.orgIds.join(',')}}`}::uuid[])` : sql``}
        order by coalesce(d.last_checked_at, d.created_at), d.id
        limit 500`),
  );
  const due = rows
    .filter((r) =>
      recheckDue(
        {
          createdAt: new Date(r.created_at),
          lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at) : null,
        },
        now,
      ),
    )
    .slice(0, deps.batch ?? 50);
  let checked = 0;
  let activated = 0;
  for (const d of due) {
    const budget = await store.hit(
      `domains:provider:${deps.provider.name}`,
      { limit, windowMs: HOUR },
      now.getTime(),
    );
    if (!budget.allowed)
      return {
        due: due.length,
        checked,
        activated,
        failed: 0,
        rateLimited: true,
        retryAfterMs: budget.retryAfterMs,
      };
    let check: Awaited<ReturnType<DomainProvider['checkDomain']>>;
    try {
      check = await deps.provider.checkDomain(d.hostname);
    } catch (err) {
      console.warn(JSON.stringify({ job: 'domains.recheck', host: d.hostname, error: String(err) }));
      return { due: due.length, checked, activated, failed: 1, rateLimited: false, retryAfterMs: 0 };
    }
    const ctx = createCtx({ orgId: d.org_id, actor: { type: 'system', name: 'domains.recheck' }, now });
    try {
      const r = await executeCommand(recordDomainCheckCommand, { domainId: d.id, check }, ctx, ports);
      checked += 1;
      if (r.status === 'active') {
        activated += 1;
        if (deps.payments && !r.walletsReady) await registerWallets(deps.payments, ctx, d.id, d.hostname);
      }
    } catch (err) {
      // Removed or changed meanwhile (the organizer was quicker): nothing to record.
      if (isDomainError(err) && (err.code === 'not_found' || err.code === 'invalid_state')) continue;
      throw err;
    }
  }
  return { due: due.length, checked, activated, failed: 0, rateLimited: false, retryAfterMs: 0 };
}

/**
 * The job the leader runs every minute: `recheckPendingDomains`, skipped while backing off after
 * provider failures (1, 2, 4 … minutes, at most 30) or until the hourly budget frees up.
 */
export function domainRecheckJob(deps: Omit<DomainRecheckDeps, 'now'>) {
  let failures = 0;
  let notBefore = 0;
  return {
    get failures() {
      return failures;
    },
    get notBefore() {
      return notBefore;
    },
    async tick(now: Date = new Date()): Promise<DomainRecheckRun | null> {
      if (now.getTime() < notBefore) return null;
      let run: DomainRecheckRun;
      try {
        run = await recheckPendingDomains({ ...deps, now });
      } catch (err) {
        failures += 1;
        notBefore = now.getTime() + providerBackoffMs(failures);
        throw err;
      }
      if (run.failed > 0) {
        failures += 1;
        notBefore = now.getTime() + providerBackoffMs(failures);
      } else {
        failures = 0;
        notBefore = run.rateLimited ? now.getTime() + run.retryAfterMs : 0;
      }
      return run;
    },
  };
}
