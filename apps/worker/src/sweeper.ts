import { billingEntitlements } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { expireOrdersCommand, sweepWaitlistsCommand } from '@yayatoh/orders';
import { alertDisputeDeadlinesCommand } from '@yayatoh/payments';
import { createCommandPorts, localKeyVault, setKeyVault } from '@yayatoh/platform';
import { sweepEnrollmentsCommand } from '@yayatoh/registration';
import { orgAuthorizer, orgStatusGate } from '@yayatoh/tenancy';
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
