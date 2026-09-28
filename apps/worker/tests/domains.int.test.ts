import { withTenant } from '@yayatoh/db';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { memoryRateLimitStore } from '@yayatoh/platform/security';
import {
  addDomainCommand,
  type DomainProvider,
  fakeDomainProvider,
  listDomainsQuery,
  recordDomainCheckCommand,
  setOrgStatusCommand,
} from '@yayatoh/tenancy';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domainRecheckJob, recheckPendingDomains } from '../src/domains.ts';

const SECRET = 'domains-recheck-test-secret-0123456789';
const provider = fakeDomainProvider({ secret: SECRET });
const payments = fakePaymentProvider({ secret: SECRET, appOrigin: 'https://app.test' });
const audited: string[] = [];
const tag = uuidv7().slice(-8);
const MIN = 60_000;

let a: OrgFixture;
let b: OrgFixture;
let t0: number;

/** Add a domain as the web does: claim it, ask the provider, record its first answer. */
async function add(o: OrgFixture, hostname: string) {
  const d = await executeCommand(addDomainCommand, { hostname }, o.ctx(), ports);
  const { providerRef, ...check } = await provider.addDomain(d.hostname);
  await executeCommand(recordDomainCheckCommand, { domainId: d.id, providerRef, check }, o.ctx(), ports);
  return d.hostname;
}
const domainsOf = async (o: OrgFixture) =>
  new Map((await executeQuery(listDomainsQuery, {}, o.ctx(), ports)).map((d) => [d.hostname, d]));
const at = (ms: number, base = t0) => new Date(base + ms);

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor, reason }) => void audited.push(`${actor}|${reason}`));
  ({ a, b } = await twoOrgs());
  t0 = Date.now();
});
afterAll(closePools);

describe('pending domain re-check job (M1.3f)', () => {
  it('a domain goes from pending to active without "Check now": primary, wallets, one activation event', async () => {
    const live = await add(a, `shop-${tag}.verified.test`);
    const waiting = await add(a, `slow-${tag}.example.test`);
    const broken = await add(a, `bad-${tag}.fail.test`);
    const other = await add(b, `other-${tag}.example.test`);
    const only = { orgIds: [a.org.id] };
    const store = memoryRateLimitStore();

    // Just added (checked once when added): not due for a minute.
    let r = await recheckPendingDomains({ provider, payments, store, ...only, now: at(30_000) });
    expect(r).toMatchObject({ due: 0, checked: 0 });

    r = await recheckPendingDomains({ provider, payments, store, ...only, now: at(MIN + 5_000) });
    expect(r).toMatchObject({ due: 3, checked: 3, activated: 1, failed: 0, rateLimited: false });
    const mine = await domainsOf(a);
    expect(mine.get(live)).toMatchObject({ status: 'active', isPrimary: true, walletsReady: true });
    expect(mine.get(waiting)).toMatchObject({ status: 'pending_dns', isPrimary: false });
    expect(mine.get(waiting)?.lastCheckedAt?.getTime()).toBe(at(MIN + 5_000).getTime());
    expect(mine.get(broken)).toMatchObject({ status: 'failed', failureReason: 'dns_conflict' });
    // The other org was not in this run.
    expect((await domainsOf(b)).get(other)?.lastCheckedAt?.getTime()).not.toBe(at(MIN + 5_000).getTime());

    // Backs off: the pending one waits another minute; active and failed ones are done.
    r = await recheckPendingDomains({ provider, payments, store, ...only, now: at(MIN + 40_000) });
    expect(r).toMatchObject({ due: 0, checked: 0 });
    r = await recheckPendingDomains({ provider, payments, store, ...only, now: at(2 * MIN + 10_000) });
    expect(r).toMatchObject({ due: 1, checked: 1, activated: 0 });

    // Idempotent: activation and its event happened once, whoever checks again.
    const [{ n } = { n: 0 }] = await withTenant(
      createCtx({ orgId: a.org.id, actor: { type: 'system', name: 't' } }),
      (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from platform.domain_events where type = 'domain.activated' and payload->>'hostname' = ${live}`,
        ),
    );
    expect(n).toBe(1);
    // The cross-tenant listing went through platform_reader, audited.
    expect(audited).toContain('system:domains.recheck|list pending custom domains to check again');
  });

  it('respects the hourly provider budget and says when it frees up', async () => {
    const { a: o } = await twoOrgs();
    await add(o, `one-${tag}.example.test`);
    await add(o, `two-${tag}.example.test`);
    const s0 = Date.now();
    const r = await recheckPendingDomains({
      provider,
      store: memoryRateLimitStore(),
      limitPerHour: 1,
      orgIds: [o.org.id],
      now: at(2 * MIN, s0),
    });
    expect(r).toMatchObject({ due: 2, checked: 1, rateLimited: true });
    expect(r.retryAfterMs).toBeGreaterThan(0);
    // Sliding window: at most two windows away.
    expect(r.retryAfterMs).toBeLessThanOrEqual(2 * 3_600_000);
  });

  it('backs off after provider failures (1, 2 … minutes) and resets after a clean run', async () => {
    const { a: o } = await twoOrgs();
    await add(o, `flaky-${tag}.verified.test`);
    const s0 = Date.now();
    let down = true;
    const flaky: DomainProvider = {
      ...provider,
      async checkDomain(host) {
        if (down) throw new Error('provider 503');
        return provider.checkDomain(host);
      },
    };
    const job = domainRecheckJob({ provider: flaky, store: memoryRateLimitStore(), orgIds: [o.org.id] });
    expect(await job.tick(at(2 * MIN, s0))).toMatchObject({ failed: 1, checked: 0 });
    expect(job.failures).toBe(1);
    // Backing off: skipped until a minute has passed.
    expect(await job.tick(at(2 * MIN + 30_000, s0))).toBeNull();
    expect(await job.tick(at(3 * MIN + 1_000, s0))).toMatchObject({ failed: 1 });
    expect(job.failures).toBe(2);
    expect(await job.tick(at(4 * MIN + 1_000, s0))).toBeNull();
    down = false;
    expect(await job.tick(at(5 * MIN + 2_000, s0))).toMatchObject({ failed: 0, checked: 1, activated: 1 });
    expect(job.failures).toBe(0);
  });

  it('skips suspended orgs and domains older than a week', async () => {
    const { a: o } = await twoOrgs();
    const host = await add(o, `paused-${tag}.verified.test`);
    const s0 = Date.now();
    await executeCommand(
      setOrgStatusCommand,
      { action: 'suspend', reason: 'test: suspended' },
      createCtx({ orgId: o.org.id, actor: { type: 'system', name: 'staff:test' } }),
      ports,
    );
    const store = memoryRateLimitStore();
    expect(
      await recheckPendingDomains({ provider, store, orgIds: [o.org.id], now: at(2 * MIN, s0) }),
    ).toMatchObject({ due: 0, checked: 0 });
    await executeCommand(
      setOrgStatusCommand,
      { action: 'reactivate', reason: 'test: back' },
      createCtx({ orgId: o.org.id, actor: { type: 'system', name: 'staff:test' } }),
      ports,
    );
    expect(
      await recheckPendingDomains({ provider, store, orgIds: [o.org.id], now: at(8 * 24 * 60 * MIN, s0) }),
    ).toMatchObject({ due: 0 });
    expect(
      await recheckPendingDomains({ provider, store, orgIds: [o.org.id], now: at(2 * MIN, s0) }),
    ).toMatchObject({ due: 1, activated: 1 });
    expect((await domainsOf(o)).get(host)?.status).toBe('active');
  });
});
