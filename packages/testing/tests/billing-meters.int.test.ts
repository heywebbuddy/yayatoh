import { adjustCreditsCommand, debitDraftCreditCommand, refundDraftCreditCommand } from '@yayatoh/ai';
import {
  billingUsageMeter,
  type FakeBillingProvider,
  fakeBillingProvider,
  METERS,
  type Meter,
  recordUsageTx,
  reportOrgUsage,
  USAGE_EVENTS,
  usageFromEvent,
  usageSummaryQuery,
} from '@yayatoh/billing';
import { enrollDeviceCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { consumeEvent, type PublishedEvent, recentEventsTx } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/*
 * M6.6b meters: usage from the outbox (messaging sends, AI credits, devices) → billing.usage_records
 * → the provider's meter API (the fake). Acceptance: the meters match the usage events exactly
 * over a fixture month, with no double count on replay.
 */

const SECRET = 'billing-meters-int-secret-'.padEnd(64, 'm');
const TYPES = USAGE_EVENTS.map((k) => k.split('@')[0] as string);

let a: OrgFixture;
let b: OrgFixture;
const prior = process.env.BILLING_ENABLED;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  process.env.BILLING_ENABLED = '1';
});
afterAll(async () => {
  if (prior === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = prior;
  await closePools();
});

const usageEvents = (f: OrgFixture) =>
  withTenant(systemCtx(f.org.id), (tx) => recentEventsTx(tx, f.org.id, TYPES, 24 * 3600_000));

/** Expected totals per meter, straight from the outbox events. */
const expectedFrom = (events: readonly PublishedEvent[]) => {
  const out = Object.fromEntries(METERS.map((m) => [m, 0])) as Record<Meter, number>;
  for (const e of events) for (const u of usageFromEvent(e)) out[u.meter] += u.quantity;
  return out;
};

const recorded = async (f: OrgFixture, since?: Date) => {
  const rows = await withTenant(systemCtx(f.org.id), (tx) =>
    tx.execute<{ meter: Meter; q: string; n: number }>(
      sql`select meter, sum(quantity)::bigint as q, count(*)::int as n from billing.usage_records
          ${since ? sql`where occurred_at >= ${since.toISOString()}::timestamptz` : sql``} group by meter`,
    ),
  );
  const out = Object.fromEntries(METERS.map((m) => [m, 0])) as Record<Meter, number>;
  for (const r of rows) out[r.meter] = Number(r.q);
  return { totals: out, rows: rows.reduce((n, r) => n + r.n, 0) };
};

const meter = billingUsageMeter();
const drain = async (f: OrgFixture) => {
  let fresh = 0;
  for (const e of await usageEvents(f)) if (await consumeEvent(meter, e)) fresh += 1;
  return fresh;
};

/** A month of real usage through the real commands: drafts (one refunded), devices, emails. */
async function useTheProduct(f: OrgFixture) {
  await executeCommand(
    adjustCreditsCommand,
    { balance: 50, reason: 'meters test' },
    systemCtx(f.org.id),
    ports,
  );
  const debits: string[] = [];
  for (const kind of ['description', 'description', 'faq'] as const) {
    const r = await executeCommand(debitDraftCreditCommand, { eventId: f.event.id, kind }, f.ctx(), ports);
    debits.push(r.debitId);
  }
  await executeCommand(refundDraftCreditCommand, { debitId: debits[0] as string }, f.ctx(), ports);
  for (const label of ['Door A', 'Door B'])
    await executeCommand(enrollDeviceCommand, { label: `${label} ${uuidv7().slice(-4)}` }, f.ctx(), ports);
  const notifier = createNotifier();
  await withTenant(systemCtx(f.org.id), async (tx) => {
    for (const n of [1, 2, 3])
      await notifier.enqueue(tx, {
        kind: 'attendees.message',
        to: { email: `meter${n}+${f.org.slug}@example.test`, timeZone: 'UTC' },
        params: { subject: 'Hi', body: 'Usage', name: 'Fan', eventName: f.event.name },
        dedupeKey: `meters:${f.org.id}:${n}`,
        eventId: f.event.id,
      });
  });
  const { transports, emails } = memoryTransports();
  await dispatchDue(f.org.id, { transports, appOrigin: 'https://app.yayatoh.test', ignoreQuietHours: true });
  return { emails: emails.filter((e) => e.to.startsWith('meter')).length };
}

describe('usage events (M6.6b)', () => {
  it('a sent message, a spent or refunded AI credit and an enrolled device each emit a usage event', async () => {
    const before = await usageEvents(a);
    const sent = await useTheProduct(a);
    expect(sent.emails).toBe(3);
    const after = await usageEvents(a);
    const fresh = after.filter((e) => !before.some((x) => x.id === e.id));
    const count = (type: string) => fresh.filter((e) => e.type === type).length;
    expect(count('ai.credits_spent')).toBe(3);
    expect(count('ai.credits_refunded')).toBe(1);
    expect(count('device.enrolled')).toBe(2);
    expect(count('messaging.usage_metered')).toBeGreaterThanOrEqual(3);
    const email = fresh.find((e) => e.type === 'messaging.usage_metered');
    expect(email?.payload).toMatchObject({ orgId: a.org.id, channel: 'email', units: 1 });
    // The event names the message, never its recipient or content.
    expect(JSON.stringify(fresh.map((e) => e.payload))).not.toContain('@example.test');
  });
});

describe('meters match the usage events exactly (M6.6b acceptance)', () => {
  it('over the fixture month: every meter equals the sum of its events', async () => {
    await drain(a);
    const events = await usageEvents(a);
    const expected = expectedFrom(events);
    const { totals } = await recorded(a);
    // Every usage row comes from an outbox event (the fixture's synthetic device row aside).
    const fixtureRow = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from billing.usage_records u where not exists
          (select 1 from platform.domain_events d where d.id = u.source_event_id)`,
      ),
    );
    expect(totals.devices - (fixtureRow[0]?.n ?? 0)).toBe(expected.devices);
    for (const m of ['email', 'sms', 'whatsapp', 'ai_credits'] as const) expect(totals[m]).toBe(expected[m]);
    expect(expected.ai_credits).toBeGreaterThanOrEqual(2);
  });

  it('a replayed or redelivered event never counts twice', async () => {
    const before = await recorded(a);
    // The relay delivers everything again: the processed-events ledger stops it…
    expect(await drain(a)).toBe(0);
    // …and even a delivery that bypasses the ledger (another consumer name, a manual replay) is
    // stopped by the usage row's unique (event, meter) key.
    const events = await usageEvents(a);
    let fresh = 0;
    await withTenant(systemCtx(a.org.id), async (tx) => {
      for (const e of events) fresh += await recordUsageTx(tx, e);
    });
    expect(fresh).toBe(0);
    expect(await recorded(a)).toEqual(before);
  });

  it('reports each record once to the provider meters; the provider total equals the events', async () => {
    const provider: FakeBillingProvider = fakeBillingProvider({ secret: SECRET });
    const [start] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ at: Date | string }>(sql`select min(created_at) as at from billing.subscriptions`),
    );
    const since = new Date(start?.at ?? 0);
    const eligible = await recorded(a, since);
    const r1 = await reportOrgUsage(a.org.id, provider, ports, { enabled: true });
    expect(r1).toEqual({ reported: eligible.rows, failed: 0 });
    expect(eligible.rows).toBeGreaterThanOrEqual(8);
    const sums = Object.fromEntries(METERS.map((m) => [m, 0])) as Record<Meter, number>;
    for (const e of provider.meterEvents) sums[e.meter] += e.quantity;
    expect(sums).toEqual(eligible.totals);
    // The customer is the org's own; identifiers are our record ids.
    expect(new Set(provider.meterEvents.map((e) => e.customerId)).size).toBe(1);
    // Nothing is sent twice: a second pass has nothing left.
    expect(await reportOrgUsage(a.org.id, provider, ports, { enabled: true })).toEqual({
      reported: 0,
      failed: 0,
    });
    // Usage from before the first subscription (free) is never reported.
    const [old] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from billing.usage_records where reported_at is not null and occurred_at < ${since.toISOString()}::timestamptz`,
      ),
    );
    expect(old?.n).toBe(0);
  });

  it('a record the provider refuses is retried on the next pass, then sent once', async () => {
    await withTenant(systemCtx(a.org.id), (tx) =>
      recordUsageTx(tx, {
        id: uuidv7(),
        orgId: a.org.id,
        type: 'device.enrolled',
        version: 1,
        payload: { orgId: a.org.id },
        occurredAt: new Date().toISOString(),
      }),
    );
    const good = fakeBillingProvider({ secret: SECRET });
    const flaky = { ...good, reportUsage: async () => Promise.reject(new Error('meter API down')) };
    expect(await reportOrgUsage(a.org.id, flaky, ports, { enabled: true })).toEqual({
      reported: 0,
      failed: 1,
    });
    expect(await reportOrgUsage(a.org.id, good, ports, { enabled: true })).toEqual({
      reported: 1,
      failed: 0,
    });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ attempts: number }>(
        sql`select report_attempts as attempts from billing.usage_records order by created_at desc limit 1`,
      ),
    );
    expect(row?.attempts).toBe(1);
  });

  it('billing off: usage is still counted, nothing is reported', async () => {
    const provider = fakeBillingProvider({ secret: SECRET });
    await withTenant(systemCtx(a.org.id), (tx) =>
      recordUsageTx(tx, {
        id: uuidv7(),
        orgId: a.org.id,
        type: 'ai.credits_spent',
        version: 1,
        payload: { credits: 1 },
        occurredAt: new Date().toISOString(),
      }),
    );
    expect(await reportOrgUsage(a.org.id, provider, ports, { enabled: false })).toEqual({
      reported: 0,
      failed: 0,
    });
    expect(provider.meterEvents).toHaveLength(0);
  });
});

describe('the usage page query (M6.6b)', () => {
  const now = new Date('2031-03-15T12:00:00Z');
  beforeAll(async () => {
    // Late on the last day of February in UTC: still February in New York, already March in Auckland.
    for (const [meter, at, q] of [
      ['sms', '2031-02-28T23:30:00Z', 4],
      ['sms', '2031-03-02T10:00:00Z', 1],
      ['email', '2031-01-10T10:00:00Z', 7],
    ] as const)
      await withTenant(systemCtx(b.org.id), (tx) =>
        recordUsageTx(tx, {
          id: uuidv7(),
          orgId: b.org.id,
          type: meter === 'sms' ? 'messaging.usage_metered' : 'messaging.usage_metered',
          version: 1,
          payload: { channel: meter, units: q },
          occurredAt: at,
        }),
      );
  });

  it('counts months in the org time zone, current month first, then history', async () => {
    const ny = await executeQuery(usageSummaryQuery, { timeZone: 'America/New_York' }, b.ctx({ now }), ports);
    expect(ny.period.month).toBe('2031-03');
    expect(ny.period.start.toISOString()).toBe('2031-03-01T05:00:00.000Z');
    expect(ny.current.find((c) => c.meter === 'sms')?.quantity).toBe(1);
    expect(ny.history.map((h) => h.month)).toEqual(['2031-02', '2031-01']);
    expect(ny.history[0]?.totals.find((t) => t.meter === 'sms')).toEqual({
      meter: 'sms',
      quantity: 4,
      records: 1,
    });
    expect(ny.current.map((c) => c.meter)).toEqual([...METERS]);
    const akl = await executeQuery(
      usageSummaryQuery,
      { timeZone: 'Pacific/Auckland' },
      b.ctx({ now }),
      ports,
    );
    expect(akl.current.find((c) => c.meter === 'sms')?.quantity).toBe(5);
    expect(akl.history.map((h) => h.month)).toEqual(['2031-01']);
  });

  it('filters by meter; an unknown time zone is refused', async () => {
    const sms = await executeQuery(
      usageSummaryQuery,
      { timeZone: 'America/New_York', meter: 'sms' },
      b.ctx({ now }),
      ports,
    );
    expect(sms.current.map((c) => c.meter)).toEqual(['sms']);
    expect(sms.history.map((h) => h.month)).toEqual(['2031-02']);
    await expect(
      executeQuery(usageSummaryQuery, { timeZone: 'Mars/Olympus' }, b.ctx({ now }), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('viewers are refused; each org sees only its own usage', async () => {
    const viewer = b.ctx({ actor: { type: 'user', userId: b.viewerId } });
    try {
      await executeQuery(usageSummaryQuery, { timeZone: 'UTC' }, viewer, ports);
      expect.unreachable();
    } catch (err) {
      expect(isDomainError(err) && err.code).toBe('forbidden');
    }
    const fromA = await executeQuery(usageSummaryQuery, { timeZone: 'UTC' }, a.ctx({ now }), ports);
    expect(fromA.history.find((h) => h.month === '2031-02')).toBeUndefined();
    const crossed = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from billing.usage_records where org_id = ${b.org.id}`,
      ),
    );
    expect(crossed[0]?.n).toBe(0);
  });
});
