import { scanTicketCommand } from '@yayatoh/checkin';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { catchUpMetrics, METRIC_EVENTS, METRICS_CONSUMER, metricsProjector } from '@yayatoh/reports';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayOnce } from '../src/relay.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M3.1 acceptance: projector lag p95 ≤ 2 s at 20 scans/s. A synthetic door stream (real scan
 * commands, 20 per second for 10 seconds) runs against the production path: the single-leader
 * relay loop (same cadence as main.ts) and the pg-boss worker running the metrics projector.
 * Lag is what the projector records: domain event written → projection committed.
 */

const RATE_PER_S = 20;
const SECONDS = 10;
const SCANS = RATE_PER_S * SECONDS;
const DURING = new Date('2028-06-01T23:30:00Z');

let a: OrgFixture;
let admin: AdminSql;
let boss: PgBoss;
let eventId: string;
let codes: string[] = [];
let stopping = false;
let relayLoop: Promise<void> | undefined;
const projector = metricsProjector();

async function waitFor(check: () => Promise<boolean>, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Every relayed metric event (any org) has been handled by the projector. */
const backlogDone = async () => {
  const [r] = await admin<{ n: number }[]>`
    select count(*)::int as n from platform.domain_events d
    where d.published_at is not null and d.type || '@' || d.version = any(${[...METRIC_EVENTS]})
      and not exists (select 1 from platform.processed_events p
        where p.org_id = d.org_id and p.consumer = ${METRICS_CONSUMER} and p.event_id = d.id)`;
  return r?.n === 0;
};

beforeAll(async () => {
  setPlatformAuditSink(async () => {});
  admin = adminClient();
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Door rush',
        timezone: 'UTC',
        startsAt: '2028-06-01T23:00:00Z',
        endsAt: '2028-06-02T03:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const type = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'General', priceMinor: 1000, quantityTotal: SCANS },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (let i = 0; i < SCANS / 10; i++) {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId: type.id, quantity: 10 }],
        buyer: { email: `crowd${i}@example.test`, name: `Crowd ${i}` },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    const pi = `fakepi_lag_${c.order.id}`;
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${pi}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: c.order.totalMinor,
        currency: 'USD',
        orgId: a.org.id,
        orderId: c.order.id,
      },
      systemCtx(a.org.id),
      ports,
    );
  }
  codes = (
    await admin<{ short_code: string }[]>`
      select short_code from ticketing.tickets where event_id = ${eventId} order by serial`
  ).map((r) => r.short_code);
  // Set-up events are projected before the stream, so only door scans are measured.
  await catchUpMetrics(a.org.id);

  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [],
    subscribers: [projector],
  });
  // The relay loop exactly as main.ts runs it (50 ms after a busy tick, 500 ms when idle).
  relayLoop = (async () => {
    while (!stopping) {
      let n = 0;
      try {
        n = await relayOnce(boss, [projector]);
      } catch (err) {
        console.error('relay', err);
      }
      await new Promise((r) => setTimeout(r, n > 0 ? 50 : 500));
    }
  })();
  // Drain whatever earlier test files left unpublished before measuring.
  expect(await waitFor(backlogDone, 120_000)).toBe(true);
}, 240_000);

afterAll(async () => {
  stopping = true;
  await relayLoop;
  await boss?.stop({ graceful: false });
  await admin?.end();
  await closePools();
});

describe('metrics projector lag (M3.1 acceptance)', () => {
  it(`p95 ≤ 2 s at ${RATE_PER_S} scans/s`, async () => {
    expect(codes).toHaveLength(SCANS);
    const started = Date.now();
    // Only the stream's scans (the org fixture checked in one ticket of its own).
    const since = new Date(started - 1000);
    const scans: Promise<unknown>[] = [];
    for (let i = 0; i < SCANS; i++) {
      // Open-loop arrivals: scan i starts at i / rate seconds, whatever the previous one did.
      const due = started + (i * 1000) / RATE_PER_S;
      const wait = due - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      scans.push(
        executeCommand(scanTicketCommand, { eventId, code: codes[i] }, a.ctx({ now: DURING }), ports),
      );
    }
    const results = (await Promise.all(scans)) as { result: string }[];
    expect(results.filter((r) => r.result === 'admitted')).toHaveLength(SCANS);
    const streamSeconds = (Date.now() - started) / 1000;
    expect(streamSeconds).toBeLessThan(SECONDS + 3);

    const allProjected = async () => {
      const [r] = await admin<{ n: number }[]>`
        select count(*)::int as n from reports.projector_lag
        where org_id = ${a.org.id} and consumer = ${METRICS_CONSUMER} and event_type = 'ticket.admitted'
          and occurred_at >= ${since}`;
      return r?.n === SCANS;
    };
    expect(await waitFor(allProjected, 60_000)).toBe(true);
    const [stats] = await admin<{ p50: number; p95: number; max: number; n: number }[]>`
      select count(*)::int as n,
        percentile_disc(0.5) within group (order by lag_ms) as p50,
        percentile_disc(0.95) within group (order by lag_ms) as p95,
        max(lag_ms) as max
      from reports.projector_lag
      where org_id = ${a.org.id} and consumer = ${METRICS_CONSUMER} and event_type = 'ticket.admitted'
          and occurred_at >= ${since}`;
    console.info(
      `metrics lag at ${RATE_PER_S} scans/s over ${streamSeconds.toFixed(1)} s: ` +
        `n=${stats?.n} p50=${stats?.p50} ms p95=${stats?.p95} ms max=${stats?.max} ms`,
    );
    expect(stats?.n).toBe(SCANS);
    expect(Number(stats?.p95)).toBeLessThanOrEqual(2000);

    // And the numbers are right: every scan counted once.
    const [count] = await admin<{ v: string }[]>`
      select sum(value)::text as v from reports.metric_snapshots
      where event_id = ${eventId} and key = 'checkins.tickets'`;
    expect(Number(count?.v)).toBe(SCANS);
  }, 120_000);
});
