import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { collectPledges } from '@yayatoh/donations';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { expireOrdersCommand, sweepWaitlistsCommand } from '@yayatoh/orders';
import { alertDisputeDeadlinesCommand, type PaymentProvider } from '@yayatoh/payments';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { sweepEnrollmentsCommand } from '@yayatoh/registration';
import {
  orgAuthorizer,
  orgStatusGate,
  summarizeApiKeyUsageCommand,
  unsummarizedApiKeyUsage,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';

if (process.env.LOCAL_KMS_KEY) setKeyVault(localKeyVault(process.env.LOCAL_KMS_KEY));

// The org gate (M1.3f) lets system actors through; wired for parity with the apps.
const ports = createCommandPorts({
  entitlements: billingEntitlements,
  authorizer: orgAuthorizer,
  orgGate: orgStatusGate,
});

/**
 * Hold sweeper (roadmap §5.2: every 30 s). Finds orgs with lapsed holds through a
 * SECURITY DEFINER function, then releases them per org under that org's RLS.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const orgs = await withPlatformReader(
    { actor: 'system:sweeper', reason: 'find orgs with expired checkout holds' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from orders.orgs_with_due_holds(100)`),
  );
  let total = 0;
  for (const { org_id } of orgs) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'orders.sweeper' } });
    total += (await executeCommand(expireOrdersCommand, { limit: 200 }, ctx, ports)).expired;
  }
  return total;
}

/**
 * Waitlist sweeper (M3.10a), right after the hold sweeper: lapsed offers release their stock and
 * freed stock is offered to the next people in line, per org under that org's RLS.
 */
export async function sweepWaitlists(): Promise<{ expired: number; offered: number }> {
  const orgs = await withPlatformReader(
    { actor: 'system:sweeper', reason: 'find orgs with waitlist offers to make or expire' },
    (tx) => tx.execute<{ org_id: string }>(sql`select org_id from orders.orgs_with_waitlist_work(100)`),
  );
  const total = { expired: 0, offered: 0 };
  for (const { org_id } of orgs) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'orders.waitlist-sweeper' } });
    try {
      const r = await executeCommand(sweepWaitlistsCommand, { limit: 200 }, ctx, ports);
      total.expired += r.expired;
      total.offered += r.offered;
    } catch (err) {
      // One org's failure (a lock timeout, a deadlock) never stops the others; the next tick retries.
      console.error('waitlist sweeper', org_id, err);
    }
  }
  return total;
}

/**
 * Dispute evidence deadline alerts (M3.10c), hourly: orgs with an open dispute due within three
 * days (platform_reader, audited), then each org's alerts under its RLS (each level raised once).
 */
export async function alertDisputeDeadlines(): Promise<number> {
  const orgs = await withPlatformReader(
    { actor: 'system:dispute-alerts', reason: 'find orgs with dispute evidence due soon' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select distinct org_id from payments.disputes
        where status = 'open' and evidence_due_by is not null and deadline_alert_level < 2
          and evidence_due_by <= now() + interval '72 hours'
        limit 500`),
  );
  let total = 0;
  for (const { org_id } of orgs) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'payments.dispute-alerts' } });
    try {
      total += (await executeCommand(alertDisputeDeadlinesCommand, {}, ctx, ports)).alerted;
    } catch (err) {
      console.error('dispute alerts', org_id, err);
    }
  }
  return total;
}

/**
 * Session enrollment sweeper (M5.2b), after the waitlist sweeper: lapsed session offers give their
 * place back and sessions with free places promote their lines, per org under that org's RLS.
 */
export async function sweepEnrollments(): Promise<{ expired: number; promoted: number }> {
  const orgs = await withPlatformReader(
    { actor: 'system:sweeper', reason: 'find orgs with session offers to expire or lines to promote' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select distinct org_id from registration.session_enrollments
        where status = 'waiting' or (status = 'offered' and offer_expires_at < now())
        limit 100`),
  );
  const total = { expired: 0, promoted: 0 };
  for (const { org_id } of orgs) {
    const ctx = createCtx({
      orgId: org_id,
      actor: { type: 'system', name: 'registration.enrollment-sweeper' },
    });
    try {
      const r = await executeCommand(sweepEnrollmentsCommand, { limit: 200 }, ctx, ports);
      total.expired += r.expired;
      total.promoted += r.promoted;
    } catch (err) {
      console.error('enrollment sweeper', org_id, err);
    }
  }
  return total;
}

/**
 * Pledge collection (M4.8e, P4-12), every 5 minutes: orgs with a saved-card charge due (or a
 * claimed one to replay) or a saved card past its 30 days (platform_reader, audited), then each
 * org's run under its RLS: off-session charges under each order's key (replays never charge
 * twice), declines retried once then invoiced, expired cards removed from the customer.
 */
export async function collectDuePledges(provider: PaymentProvider) {
  const orgs = await withPlatformReader(
    {
      actor: 'system:pledge-collection',
      reason: 'find orgs with pledge charges due or saved cards to remove',
    },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select org_id from donations.pledge_collections
        where status in ('scheduled', 'charging') and charge_at <= now()
        union
        select org_id from donations.saved_cards where status = 'active' and remove_after <= now()
        limit 500`),
  );
  const total = { charged: 0, declined: 0, invoiced: 0, cardsRemoved: 0 };
  for (const { org_id } of orgs) {
    try {
      const r = await collectPledges(org_id, { provider, ports });
      total.charged += r.charged;
      total.declined += r.declined;
      total.invoiced += r.invoiced;
      total.cardsRemoved += r.cardsRemoved;
    } catch (err) {
      console.error('pledge collection', org_id, err);
    }
  }
  return total;
}

/**
 * API key usage summaries (M6.3a), hourly: orgs with finished days of key usage not yet in their
 * audit log (platform_reader, audited), then one `apiKey.dailyUsage` entry per key and day under
 * each org's RLS. Each day is summarized once.
 */
export async function summarizeApiKeyUsage(): Promise<number> {
  const orgs = await withPlatformReader(
    { actor: 'system:api-key-usage', reason: 'find orgs with API key usage to summarize in the audit log' },
    (tx) =>
      tx.execute<{ org_id: string }>(sql`
        select distinct u.org_id from tenancy.api_key_usage_daily u
        join tenancy.organizations o on o.id = u.org_id
        where u.audited_at is null and u.day < (now() at time zone o.timezone)::date
        limit 500`),
  );
  let total = 0;
  for (const { org_id } of orgs) {
    const ctx = createCtx({ orgId: org_id, actor: { type: 'system', name: 'tenancy.api-key-usage' } });
    try {
      for (const row of await unsummarizedApiKeyUsage(org_id)) {
        await executeCommand(summarizeApiKeyUsageCommand, row, ctx, ports);
        total += 1;
      }
    } catch (err) {
      console.error('api key usage summaries', org_id, err);
    }
  }
  return total;
}
