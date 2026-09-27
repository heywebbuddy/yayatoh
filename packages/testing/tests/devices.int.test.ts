import {
  deviceContext,
  deviceManifestQuery,
  enrollDeviceCommand,
  heartbeatCommand,
  listDevicesQuery,
  setDeviceStateCommand,
  syncScansCommand,
} from '@yayatoh/checkin';
import {
  admittedKey,
  eventDay,
  lookupHash,
  type OfflineState,
  offlineVerdict,
} from '@yayatoh/checkin-engine';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let codes: { code: string; shortCode: string; id: string }[];

const DOORS = new Date('2027-12-01T20:00:00Z');

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Offline',
      timezone: 'America/Chicago',
      startsAt: '2027-12-01T15:00:00Z',
      endsAt: '2027-12-02T04:00:00Z',
    },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'GA', priceMinor: 0, quantityTotal: 100, maxPerOrder: 30 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: t.id, quantity: 30 }],
      buyer: { email: 'Door@Example.test', name: 'Doris' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  codes = ((await orderByManageToken(r.manageToken))?.tickets ?? []).map((x) => ({
    code: x.code,
    shortCode: x.shortCode,
    id: x.id,
  }));
});
afterAll(closePools);

async function enroll(label: string, f = a) {
  const { token, deviceId } = await executeCommand(enrollDeviceCommand, { label }, f.ctx(), ports);
  const dc = await deviceContext(token);
  if (!dc) throw new Error('enrolled device did not resolve');
  return { token, deviceId, ctx: (now = DOORS): Ctx => ({ ...dc.ctx, now }) };
}

async function loadManifest(ctx: Ctx): Promise<OfflineState> {
  const rows = [];
  let cursor: string | undefined;
  let header: Awaited<ReturnType<typeof page>>['header'] | undefined;
  const page = (c?: string) =>
    executeQuery(deviceManifestQuery, { eventId, cursor: c, limit: 7 }, ctx, ports);
  for (;;) {
    const p = await page(cursor);
    header = p.header;
    rows.push(...p.rows);
    cursor = p.cursor ?? undefined;
    if (p.complete) break;
  }
  if (!header) throw new Error('no header');
  return {
    header,
    byId: new Map(rows.map((r) => [r.ticketId, r])),
    byShortCode: new Map(rows.map((r) => [r.shortCode, r])),
    admitted: new Set(),
    lastSyncAt: new Date(header.serverTime),
  };
}

describe('scanner devices and offline sync', () => {
  it('enrolls a device whose token resolves to its org; revoked tokens stop resolving', async () => {
    const d = await enroll('Spare');
    expect(d.token).toMatch(/^yyd_/);
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ token_hash: string }>(
        sql`select token_hash from checkin.devices where id = ${d.deviceId}`,
      ),
    );
    expect(row?.token_hash).not.toContain(d.token.slice(4, 20));
    await executeCommand(setDeviceStateCommand, { deviceId: d.deviceId, action: 'revoke' }, a.ctx(), ports);
    expect(await deviceContext(d.token)).toBeNull();
    expect(await deviceContext('yyd_' + 'x'.repeat(43))).toBeNull();
  });

  it('pages the manifest; contact details leave only as salted hashes', async () => {
    const d = await enroll('Manifest');
    const m = await loadManifest(d.ctx());
    expect(m.byId.size).toBe(30);
    const row = m.byId.get(codes[0]?.id ?? '');
    expect(row?.emailHash).toBe(await lookupHash(m.header.salt, 'door@example.test'));
    expect(JSON.stringify([...m.byId.values()])).not.toContain('example.test');
    expect(Object.keys(m.header.publicKeys)).toEqual(['1']);
  });

  it('drill: 3 offline devices, cross-device duplicates flagged first-wins on corrected time', async () => {
    const devs = await Promise.all(['North', 'South', 'East'].map((l) => enroll(l)));
    const states = await Promise.all(devs.map((d) => loadManifest(d.ctx())));
    type Q = { scanId: string; code: string; deviceTs: Date; clockOffsetMs: number; verdict: string };
    const queues: Q[][] = [[], [], []];
    const offsets = [0, 90_000, -30_000]; // South's clock runs 90 s fast, East's 30 s slow
    const scan = async (dev: number, code: string, trueTime: Date) => {
      const s = states[dev] as OfflineState;
      const offset = offsets[dev] as number;
      const { verdict, ticketId } = await offlineVerdict(s, code, trueTime);
      if ((verdict === 'admit' || verdict === 'provisional') && ticketId)
        (s.admitted as Set<string>).add(admittedKey(ticketId, eventDay(trueTime, 'America/Chicago')));
      queues[dev]?.push({
        scanId: uuidv7(),
        code,
        deviceTs: new Date(trueTime.getTime() + offset),
        clockOffsetMs: -offset,
        verdict,
      });
      return verdict;
    };
    const t = (min: number) => new Date(DOORS.getTime() + min * 60_000);
    // 24 distinct tickets across devices, 3 same-device repeats, 4 cross-device duplicates, 2 bad codes.
    for (let i = 0; i < 24; i++) await scan(i % 3, (codes[i] as { code: string }).code, t(i));
    for (const i of [0, 3, 6])
      expect(await scan(i % 3, (codes[i] as { code: string }).code, t(30 + i))).toBe('duplicate');
    // Ticket 1 was admitted by South at t(1); North scans it later at t(40) → the North scan loses.
    for (const [dev, i, when] of [
      [0, 1, 40],
      [1, 0, 41],
      [2, 4, 42],
      [2, 3, 43],
    ] as const)
      expect(await scan(dev, (codes[i] as { code: string }).code, t(when))).toBe('admit');
    expect(await scan(0, 'YY1NOTAREALCODE', t(50))).toBe('invalid');
    expect(await scan(1, 'ZZZZZZZZ', t(51))).toBe('invalid');

    // Devices reconnect in the "wrong" order: the one with the losing scans syncs first.
    const sync = (dev: number) =>
      executeCommand(
        syncScansCommand,
        { eventId, scans: (queues[dev] as Q[]).map((q) => ({ ...q })) },
        (devs[dev] as { ctx: (now?: Date) => Ctx }).ctx(t(60)),
        ports,
      );
    const r2 = await sync(2);
    const r0 = await sync(0);
    const r1 = await sync(1);
    const total = r0.duplicatesOffline + r1.duplicatesOffline + r2.duplicatesOffline;
    expect(total).toBe(4);

    const counts = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ result: string; n: number }>(
        sql`select result, count(*)::int as n from checkin.scans where event_id = ${eventId} and offline group by result order by result`,
      ),
    );
    expect(Object.fromEntries(counts.map((c) => [c.result, c.n]))).toEqual({
      admitted: 24,
      duplicate: 3,
      duplicate_offline: 4,
      invalid: 2,
    });
    // Zero double admissions: one live admission per ticket, at the earliest corrected time.
    const [adm] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number; distinct_tickets: number }>(
        sql`select count(*)::int as n, count(distinct ticket_id)::int as distinct_tickets from checkin.admissions where event_id = ${eventId} and undone_at is null`,
      ),
    );
    expect(adm).toEqual({ n: 24, distinct_tickets: 24 });
    const [first] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ admitted_at: Date }>(
        sql`select admitted_at from checkin.admissions where ticket_id = ${(codes[1] as { id: string }).id} and undone_at is null`,
      ),
    );
    expect(new Date(first?.admitted_at ?? 0).toISOString()).toBe(t(1).toISOString());
    // Every duplicate raised an alert event in the sync transaction.
    const [alerts] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.domain_events where type = 'checkin.duplicate_offline'`,
      ),
    );
    expect(alerts?.n).toBe(4);

    // Re-sending a batch is idempotent (same scan ids).
    const again = await sync(0);
    expect(again.results.every((x) => !x.stored)).toBe(true);
    expect(again.duplicatesOffline).toBe(0);
  });

  it('heartbeats record health and deliver a wipe; users cannot call device commands', async () => {
    const d = await enroll('Tablet');
    const hb = await executeCommand(
      heartbeatCommand,
      { batteryPct: 81, queueDepth: 3, clockOffsetMs: -250 },
      d.ctx(),
      ports,
    );
    expect(hb.commands).toEqual([]);
    await executeCommand(setDeviceStateCommand, { deviceId: d.deviceId, action: 'wipe' }, a.ctx(), ports);
    expect(
      (await executeCommand(heartbeatCommand, { queueDepth: 0, clockOffsetMs: 0 }, d.ctx(), ports)).commands,
    ).toEqual(['wipe']);
    const listed = (await executeQuery(listDevicesQuery, {}, a.ctx(), ports)).find(
      (x) => x.id === d.deviceId,
    );
    expect(listed).toMatchObject({ batteryPct: null, queueDepth: 0, wipeRequested: true });
    await expect(
      executeCommand(syncScansCommand, { eventId, scans: [] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        syncScansCommand,
        {
          eventId,
          scans: [{ scanId: uuidv7(), code: 'X', deviceTs: DOORS, clockOffsetMs: 0, verdict: 'admit' }],
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('isolation: org B devices see neither org A events nor org A tickets', async () => {
    const d = await enroll('Bravo', b);
    await expect(executeQuery(deviceManifestQuery, { eventId }, d.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
