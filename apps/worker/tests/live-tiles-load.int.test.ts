import { enrollDeviceCommand, scanTicketCommand } from '@yayatoh/checkin';
import { checkinSpeedWidget, checkinsWidget, liveFeedWidget, type WidgetDef } from '@yayatoh/command-center';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  CHECKINS_CHANNEL,
  createRealtimeFanout,
  listenForRealtime,
  memoryRealtimeHub,
  realtimeChannelName,
} from '@yayatoh/platform';
import { catchUpMetrics, metricsProjector } from '@yayatoh/reports';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayOnce } from '../src/relay.ts';
import { startWorker } from '../src/worker.ts';

/**
 * M3.3a acceptance: live-mode tiles update within 3 s (p95) under simulated load. A door stream of
 * 20 scans a second for 10 seconds (real scan commands from a check-in device, open-loop arrivals)
 * runs against the production path: scans publish on `event.checkins` in their transaction; a web
 * process's fan-out (LISTEN/NOTIFY, as the SSE endpoint uses) delivers them; the board re-reads
 * its tiles once per burst (250 ms, as `board.tsx` does) through the widget loaders; the metrics
 * projector runs in the pg-boss worker behind the single-leader relay loop (the speed chart's
 * per-minute series). A scan's tile latency is commit → the end of the first re-read whose tiles
 * all count it: the check-in count, the live feed and the speed chart's series.
 *
 * Run on its own: `pnpm vitest run --project integration apps/worker/tests/live-tiles-load.int.test.ts`.
 */

const RATE_PER_S = 20;
const SECONDS = 10;
const SCANS = RATE_PER_S * SECONDS;
const BURST_MS = 250;

let a: OrgFixture;
let admin: AdminSql;
let boss: PgBoss;
let eventId: string;
let deviceId: string;
let codes: string[] = [];
let stopping = false;
let relayLoop: Promise<void> | undefined;
let backlog: string[] = [];
const projector = metricsProjector();

beforeAll(async () => {
  setPlatformAuditSink(async () => {});
  admin = adminClient();
  ({ a } = await twoOrgs());
  const now = Date.now();
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Door rush (live mode)',
        slug: `live-load-${uuidv7().slice(-12)}`,
        timezone: 'America/Chicago',
        startsAt: new Date(now - 30 * 60_000).toISOString(),
        endsAt: new Date(now + 4 * 3_600_000).toISOString(),
      },
      a.ctx(),
      ports,
    )
  ).id;
  const type = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: SCANS, maxPerOrder: 50 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (let i = 0; i < SCANS / 50; i++)
    await executeCommand(
      startCheckoutCommand,
      {
        eventId,
        items: [{ ticketTypeId: type.id, quantity: 50 }],
        buyer: { email: `rush${i}@example.test`, name: `Rush ${i}` },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
  codes = (
    await admin<{ short_code: string }[]>`
      select short_code from ticketing.tickets where event_id = ${eventId} order by serial`
  ).map((r) => r.short_code);
  deviceId = (await executeCommand(enrollDeviceCommand, { label: 'Rush door' }, a.ctx(), ports)).deviceId;
  await catchUpMetrics(a.org.id);

  boss = await startWorker({
    connectionString: process.env.MIGRATOR_DATABASE_URL as string,
    jobs: [],
    subscribers: [projector],
  });
  // As the M3.1 lag test: publish what other files left in the outbox without delivering it, so
  // the measured queue holds only this stream (handed back in afterAll).
  const before = await admin<{ id: string }[]>`
    select id from platform.domain_events where published_at is null`;
  backlog = before.map((r) => r.id);
  while ((await relayOnce(boss, [], 1000)) > 0);
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
}, 240_000);

afterAll(async () => {
  stopping = true;
  await relayLoop;
  await boss?.stop({ graceful: false });
  if (backlog.length)
    await admin`update platform.domain_events set published_at = null where id = any(${backlog}::uuid[])`;
  await admin?.end();
  await closePools();
});

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] as number;
};

describe('live mode tiles under load (M3.3a acceptance)', () => {
  it(`update within 3 s (p95) at ${RATE_PER_S} scans/s`, async () => {
    expect(codes).toHaveLength(SCANS);
    const read = <O>(w: WidgetDef<O>) => executeQuery(w.loader, { eventId, params: {} }, a.ctx(), ports);
    const feedWidget = liveFeedWidget(null);

    // A web process following the event's check-in channel, re-reading the tiles once per burst.
    const hub = memoryRealtimeHub();
    const fanout = createRealtimeFanout({ hub });
    const listener = await listenForRealtime(fanout);
    /** Scans in commit order: when each was scanned and when it committed. */
    const committed: { scannedAt: number; at: number }[] = [];
    const seen: number[] = new Array(SCANS).fill(0);
    let rereads = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reading: Promise<void> = Promise.resolve();
    const reread = () => {
      reading = reading.then(async () => {
        const [c, f, s] = await Promise.all([
          read(checkinsWidget),
          read(feedWidget),
          read(checkinSpeedWidget),
        ]);
        const done = Date.now();
        rereads += 1;
        // The i-th committed scan shows when the count and the chart reach i + 1 and the feed's
        // newest entry is at least as recent as it.
        const counted = Math.min(
          c.total,
          s.series.reduce((sum, p) => sum + p.count, 0),
        );
        const newest = f.items[0] ? Date.parse(f.items[0].at) : 0;
        for (let i = 0; i < counted; i++) {
          const scan = committed[i];
          if (!seen[i] && scan && newest >= scan.scannedAt) seen[i] = done;
        }
      });
    };
    hub.subscribe(realtimeChannelName(CHECKINS_CHANNEL, a.org.id, eventId), () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        reread();
      }, BURST_MS);
    });

    const started = Date.now();
    const device = createCtx({ orgId: a.org.id, actor: { type: 'system', name: `device:${deviceId}` } });
    const scans: Promise<unknown>[] = [];
    for (let i = 0; i < SCANS; i++) {
      const due = started + (i * 1000) / RATE_PER_S;
      const wait = due - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const now = new Date();
      scans.push(
        executeCommand(
          scanTicketCommand,
          { eventId, code: codes[i] as string },
          { ...device, now },
          ports,
        ).then((r) => {
          committed.push({ scannedAt: now.getTime(), at: Date.now() });
          return r;
        }),
      );
    }
    const results = (await Promise.all(scans)) as { result: string }[];
    expect(results.filter((r) => r.result === 'admitted')).toHaveLength(SCANS);
    const streamSeconds = (Date.now() - started) / 1000;

    // The door keeps pinging until everything shows (a burst after the stream catches the tail).
    const deadline = Date.now() + 30_000;
    while (seen.some((s) => !s) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      reread();
      await reading;
    }
    await listener.close();
    fanout.close();
    expect(seen.every(Boolean)).toBe(true);
    const lat = seen.map((s, i) => s - (committed[i]?.at ?? s));
    const p50 = percentile(lat, 50);
    const p95 = percentile(lat, 95);
    console.info(
      `live tiles at ${RATE_PER_S} scans/s over ${streamSeconds.toFixed(1)} s: n=${lat.length} ` +
        `p50=${p50} ms p95=${p95} ms max=${Math.max(...lat)} ms re-reads=${rereads}`,
    );
    expect(streamSeconds).toBeLessThan(SECONDS + 3);
    expect(p95).toBeLessThanOrEqual(3000);
    // One re-read per burst, not one per scan.
    expect(rereads).toBeLessThan(SCANS / 2);
  }, 120_000);
});
