import { scanTicketCommand, undoAdmissionCommand } from '@yayatoh/checkin';
import { type Listener, withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, isPublicEvent, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import {
  ALERTS_CHANNEL,
  CHECKINS_CHANNEL,
  consumeEvent,
  createRealtimeFanout,
  latestRealtimeIdTx,
  listenForRealtime,
  memoryRealtimeHub,
  publishRealtimeTx,
  purgeRealtimeMessages,
  REALTIME_NOTIFY_CHANNEL,
  type RealtimeFanout,
  type RealtimeHub,
  type RealtimeMessage,
  realtimeCatchUpTx,
  realtimeChannelName,
  realtimeMessagesByIdTx,
  realtimeSubscriber,
} from '@yayatoh/platform';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let codes: string[];
let chA: string;
let chB: string;
const admin = adminClient();

/** Two "web processes": each has its own hub, fan-out and LISTEN connection. */
interface Proc {
  hub: RealtimeHub;
  fanout: RealtimeFanout;
  got: Map<string, RealtimeMessage[]>;
  follow(channel: string): void;
  close(): Promise<void>;
}
const procs: Proc[] = [];

async function proc(kind: 'app' | 'separate'): Promise<Proc> {
  const hub = memoryRealtimeHub();
  const fanout = createRealtimeFanout({ hub, batchMs: 2 });
  const got = new Map<string, RealtimeMessage[]>();
  let listener: Listener | { close: () => Promise<unknown> };
  if (kind === 'app') listener = await listenForRealtime(fanout);
  else {
    // A second process: its own connection to Postgres (not the app pool's shared listener).
    const req = await admin.listen(REALTIME_NOTIFY_CHANNEL, (payload) => fanout.notify(payload));
    listener = { close: () => req.unlisten() };
  }
  const p: Proc = {
    hub,
    fanout,
    got,
    follow(channel) {
      got.set(channel, []);
      hub.subscribe(channel, (m) => got.get(channel)?.push(m));
    },
    async close() {
      fanout.close();
      await listener.close();
    },
  };
  procs.push(p);
  return p;
}

async function until<T>(what: string, fn: () => T | undefined | null | false, ms = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}
const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const at = () => new Date().toISOString();
const DURING = new Date('2027-12-01T20:00:00Z');

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Live Doors',
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-03T04:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Pass', priceMinor: 0, quantityTotal: 20 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: tt.id, quantity: 3 }],
      buyer: { email: 'rt@example.test', name: 'Rae Time' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  codes = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((t) => t.code);
  chA = realtimeChannelName(CHECKINS_CHANNEL, a.org.id, eventId);
  chB = realtimeChannelName(CHECKINS_CHANNEL, b.org.id, b.event.id);
});

afterAll(async () => {
  for (const p of procs) await p.close();
  await admin.end();
  await closePools();
});

const publishAlert = (org: OrgFixture) =>
  withTenant(systemCtx(org.org.id), (tx) =>
    publishRealtimeTx(tx, org.org.id, ALERTS_CHANNEL, {
      event: 'alert',
      data: { alertId: uuidv7(), eventId: null, state: 'open', severity: 'warning', at: at() },
    }),
  );

describe('realtime publisher (M3.1b, integration)', () => {
  it('fans a committed message out to every process’s listener, once each; a rolled-back one never', async () => {
    const one = await proc('app');
    const two = await proc('separate');
    one.follow(chA);
    two.follow(chA);
    const id = await withTenant(systemCtx(a.org.id), (tx) =>
      publishRealtimeTx(tx, a.org.id, CHECKINS_CHANNEL, {
        eventId,
        event: 'admission',
        data: { change: 'admitted', checkpointId: null, count: 1, at: at(), ticketId: 'never-sent' },
      }),
    );
    for (const p of [one, two]) {
      const got = await until('delivery', () => p.got.get(chA)?.find((m) => m.id === id));
      expect(got.event).toBe('admission');
      // The allowlist dropped the extra field before it was ever stored.
      expect(got.data).not.toHaveProperty('ticketId');
    }
    await expect(
      withTenant(systemCtx(a.org.id), async (tx) => {
        await publishRealtimeTx(tx, a.org.id, CHECKINS_CHANNEL, {
          eventId,
          event: 'admission',
          data: { change: 'undone', checkpointId: null, count: 1, at: at() },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await quiet();
    await one.fanout.idle();
    await two.fanout.idle();
    expect(one.got.get(chA)?.map((m) => m.id)).toEqual([id]);
    expect(two.got.get(chA)?.map((m) => m.id)).toEqual([id]);
  });

  it('another org’s messages never reach this org’s channel, and its rows are invisible (RLS)', async () => {
    const p = await proc('app');
    p.follow(chA);
    p.follow(chB);
    const idB = await withTenant(systemCtx(b.org.id), (tx) =>
      publishRealtimeTx(tx, b.org.id, CHECKINS_CHANNEL, {
        eventId: b.event.id,
        event: 'admission',
        data: { change: 'admitted', checkpointId: null, count: 1, at: at() },
      }),
    );
    await until('B delivery', () => p.got.get(chB)?.some((m) => m.id === idB));
    expect(p.got.get(chA)).toEqual([]);
    // Under A's tenant, B's message does not exist.
    const seen = await withTenant(systemCtx(a.org.id), (tx) => realtimeMessagesByIdTx(tx, [Number(idB)]));
    expect(seen).toEqual([]);
    expect(
      await withTenant(systemCtx(a.org.id), (tx) => realtimeCatchUpTx(tx, chB, String(Number(idB) - 1))),
    ).toBeNull();
    // A message can't be filed under another org's channel, even by hand.
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(
          sql`insert into platform.realtime_messages (org_id, channel, event, data) values (${a.org.id}, ${chB}, 'admission', '{}')`,
        ),
      ),
    ).rejects.toThrow();
    // Nor written for another org (RLS WITH CHECK).
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(
          sql`insert into platform.realtime_messages (org_id, channel, event, data) values (${b.org.id}, ${chB}, 'admission', '{}')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('a reconnecting client resumes after its last id; unknown, pruned or foreign ids get a snapshot', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await publishAlert(a));
    const ch = realtimeChannelName(ALERTS_CHANNEL, a.org.id);
    const ctx = systemCtx(a.org.id);
    const missed = await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, ids[1] ?? null));
    expect(missed?.map((m) => m.id)).toEqual(ids.slice(2));
    expect(await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, ids[3] ?? null))).toEqual([]);
    expect(await withTenant(ctx, (tx) => latestRealtimeIdTx(tx, ch))).toBe(ids[3]);
    for (const bad of [null, '0', 'abc-1', '999999999999'])
      expect(await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, bad)), String(bad)).toBeNull();
    // An id from another channel is not an anchor here.
    const other = await withTenant(ctx, (tx) =>
      publishRealtimeTx(tx, a.org.id, CHECKINS_CHANNEL, {
        eventId,
        event: 'admission',
        data: { change: 'admitted', checkpointId: null, count: 1, at: at() },
      }),
    );
    expect(await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, other))).toBeNull();
    // Too far behind (over the replay limit): a snapshot instead.
    expect(await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, ids[0] ?? null, 2))).toBeNull();
    // Pruned (older than an hour): the anchor is gone, so a snapshot.
    await admin`update platform.realtime_messages set created_at = now() - interval '2 hours' where seq = ${Number(ids[1])}`;
    expect(await purgeRealtimeMessages()).toBeGreaterThanOrEqual(1);
    expect(await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, ids[1] ?? null))).toBeNull();
    expect(
      (await withTenant(ctx, (tx) => realtimeCatchUpTx(tx, ch, ids[2] ?? null)))?.map((m) => m.id),
    ).toEqual([ids[3]]);
  });

  it('the log is append-only for the app', async () => {
    const id = await publishAlert(a);
    for (const stmt of [
      sql`update platform.realtime_messages set event = 'x' where seq = ${Number(id)}`,
      sql`delete from platform.realtime_messages where seq = ${Number(id)}`,
    ]) {
      const err = await withTenant(systemCtx(a.org.id), (tx) => tx.execute(stmt)).then(
        () => null,
        (e: unknown) => e as { message?: string; cause?: { message?: string } },
      );
      expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(/permission denied/);
    }
  });

  it('check-ins publish to the event’s channel after commit: admitted and undone, nothing about the ticket', async () => {
    const p = await proc('app');
    p.follow(chA);
    const r = await executeCommand(
      scanTicketCommand,
      { eventId, code: codes[0] ?? '' },
      a.ctx({ now: DURING }),
      ports,
    );
    expect(r.result).toBe('admitted');
    const admitted = await until('admitted', () =>
      p.got.get(chA)?.find((m) => (m.data as { change: string }).change === 'admitted'),
    );
    expect(admitted.data).toEqual({
      change: 'admitted',
      checkpointId: null,
      count: 1,
      at: DURING.toISOString(),
    });
    // A duplicate scan admits nobody: no admission message, only the live feed's value-free
    // `scan` ping (M3.3a), which names no ticket either.
    const before = p.got.get(chA)?.length ?? 0;
    await executeCommand(scanTicketCommand, { eventId, code: codes[0] ?? '' }, a.ctx({ now: DURING }), ports);
    await quiet();
    await p.fanout.idle();
    const after = p.got.get(chA)?.slice(before) ?? [];
    expect(after.map((m) => [m.event, m.data])).toEqual([
      ['scan', { outcome: 'duplicate', checkpointId: null, count: 1, at: DURING.toISOString() }],
    ]);
    await executeCommand(
      undoAdmissionCommand,
      { eventId, admissionId: r.admissionId ?? '' },
      a.ctx({ now: DURING }),
      ports,
    );
    await until('undone', () =>
      p.got.get(chA)?.some((m) => (m.data as { change: string }).change === 'undone'),
    );
    const text = JSON.stringify(p.got.get(chA));
    expect(text).not.toContain('Rae');
    expect(text).not.toContain(codes[0] ?? '???');
  });

  it('outbox subscribers can publish too (exactly once per event)', async () => {
    const p = await proc('app');
    const ch = realtimeChannelName(ALERTS_CHANNEL, a.org.id);
    p.follow(ch);
    const sub = realtimeSubscriber({
      name: 'realtime.test-alerts',
      events: ['test.alert@1'],
      map: (e) => [
        {
          channel: ALERTS_CHANNEL,
          event: 'alert',
          data: { alertId: e.aggregateId, eventId: null, state: 'open', severity: 'critical', at: at() },
        },
      ],
    });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from platform.domain_events order by id limit 1`),
    );
    const alertId = uuidv7();
    const evt = {
      id: row?.id ?? '',
      orgId: a.org.id,
      type: 'test.alert',
      version: 1,
      aggregateType: 'alert',
      aggregateId: alertId,
      payload: {},
      logSeq: 0,
    };
    await consumeEvent(sub, evt);
    await consumeEvent(sub, evt);
    await until('alert', () =>
      p.got.get(ch)?.some((m) => (m.data as { alertId: string }).alertId === alertId),
    );
    await quiet();
    expect(p.got.get(ch)?.filter((m) => (m.data as { alertId: string }).alertId === alertId)).toHaveLength(1);
  });

  it('public channels open only for published, listed events of active orgs', async () => {
    expect(await isPublicEvent(a.org.id, eventId)).toBe(true);
    // The id pair must match: another org's id with this event is not public.
    expect(await isPublicEvent(b.org.id, eventId)).toBe(false);
    const draft = await executeCommand(
      createEventCommand,
      {
        name: 'Draft Doors',
        timezone: 'America/Chicago',
        startsAt: '2027-12-01T15:00:00Z',
        endsAt: '2027-12-01T20:00:00Z',
      },
      a.ctx(),
      ports,
    );
    expect(await isPublicEvent(a.org.id, draft.id)).toBe(false);
  });
});
