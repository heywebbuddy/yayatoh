import {
  dayOfQuery,
  derivedStaffAlerts,
  deviceContext,
  enrollDeviceCommand,
  guestSnapshotQuery,
  heartbeatCommand,
  markGuestsArrivedCommand,
  recordGuestArrivalsCommand,
  startKioskCommand,
  stopKioskCommand,
  supervisorViewQuery,
  undoGuestArrivalCommand,
} from '@yayatoh/checkin';
import { boardGroups, matchGuestByName, searchGuests } from '@yayatoh/checkin-engine';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type GuestCheckinScenario,
  guestCheckinScenario,
  type OrgFixture,
  ports,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M4.4b guest check-in, kiosk and A–Z board: a device downloads the guest snapshot (names, labels,
 * tables; never a contact, meal or private answer), checks guests in by name or party offline and
 * syncs once (first wins on corrected time); the host's day-of view counts arrivals, unseated
 * guests and meals; kiosks start as a guest kiosk or the board.
 */

let a: OrgFixture;
let b: OrgFixture;
let s: GuestCheckinScenario;

const NOW = new Date('2030-06-01T21:00:00Z');

async function enroll(f: OrgFixture, label: string) {
  const { token, deviceId } = await executeCommand(enrollDeviceCommand, { label }, f.ctx(), ports);
  const dc = await deviceContext(token);
  if (!dc) throw new Error('enrolled device did not resolve');
  return { deviceId, ctx: (now = NOW): Ctx => ({ ...dc.ctx, now }) };
}

async function member(role: string) {
  const id = uuidv7();
  await executeCommand(addMemberCommand, { userId: id, role }, a.ctx(), ports);
  return id;
}

const arrival = (guestId: string, deviceTs: Date, clockOffsetMs = 0, clientId = uuidv7()) => ({
  clientId,
  guestId,
  deviceTs,
  clockOffsetMs,
  source: 'scanner' as const,
});

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  s = await guestCheckinScenario(a.org.id, { ctx: a.ctx() });
}, 240_000);
afterAll(closePools);

describe('the guest snapshot (devices)', () => {
  it('carries names, labels, tables, statuses and arrivals only, and drives search, kiosk and board', async () => {
    const d = await enroll(a, 'Snapshot');
    const snap = await executeQuery(guestSnapshotQuery, { eventId: s.eventId }, d.ctx(), ports);
    const garcia = snap.parties.find((p) => p.name === 'Garcia');
    expect(garcia?.tags).toEqual(['Bride', 'Family']);
    const luis = garcia?.guests.find((g) => g.name === 'Luis López');
    expect(luis).toMatchObject({
      firstName: 'Luis',
      lastName: 'López',
      status: 'attending',
      places: [{ chart: null, kind: 'table', label: '1' }],
      arrivedAt: null,
    });
    // An allowlist: no meal, contact, dietary or other private field reaches a device.
    expect(Object.keys(luis ?? {}).sort()).toEqual(
      ['arrivedAt', 'firstName', 'guestOf', 'id', 'lastName', 'name', 'places', 'status'].sort(),
    );
    const text = JSON.stringify(snap);
    for (const leak of ['Beef', 'Fish', '@', 'envelope', 'family']) expect(text).not.toContain(leak);
    expect(snap.parties.flatMap((p) => p.guests).find((g) => g.id === s.plusOne)).toMatchObject({
      name: null,
      guestOf: 'Luis López',
    });
    expect(snap.parties.flatMap((p) => p.guests).find((g) => g.name === 'Mei Chen')?.status).toBe('declined');
    expect(snap.parties.flatMap((p) => p.guests).find((g) => g.name === 'Kofi Okafor')?.places).toEqual([]);

    // The shared engine works on it as the PWA does.
    expect(searchGuests(snap, '', ['Bride']).map((p) => p.name)).toEqual(['Garcia', 'Okafor']);
    const m = matchGuestByName(snap, 'ADA OKAFOR');
    expect(m.status === 'found' && m.guest.places).toEqual([{ chart: null, kind: 'table', label: '2' }]);
    expect(matchGuestByName(snap, 'Mei Chen').status).toBe('see_staff');
    expect(boardGroups(snap, 'en').flatMap((g) => g.entries.map((e) => e.name))).toEqual([
      'Ana García',
      'Luis López',
      'Ada Okafor',
    ]);
  });

  it('needs device credentials, and another org knows nothing of the event', async () => {
    await expect(
      executeQuery(guestSnapshotQuery, { eventId: s.eventId }, a.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    const other = await enroll(b, 'Other org');
    await expect(
      executeQuery(guestSnapshotQuery, { eventId: s.eventId }, other.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        recordGuestArrivalsCommand,
        { eventId: s.eventId, arrivals: [arrival(s.ids['Ana García'] ?? '', NOW)] },
        other.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('arrivals (offline sync, first wins)', () => {
  it('two offline devices with skewed clocks, resends and unknown guests: one arrival per guest, the earliest', async () => {
    const fast = await enroll(a, 'Fast clock');
    const slow = await enroll(a, 'Slow clock');
    const luis = s.ids['Luis López'] ?? '';
    const ada = s.ids['Ada Okafor'] ?? '';
    const t = (min: number) => new Date(NOW.getTime() - (60 - min) * 60_000);
    // The fast device's clock runs 2 minutes ahead (offset −2 min corrects it).
    const fastLuis = arrival(luis, new Date(t(10).getTime() + 120_000), -120_000);
    const fastAda = arrival(ada, new Date(t(20).getTime() + 120_000), -120_000);
    // The slow device saw Luis earlier (true t=5) and Ada later (t=30), and a stranger.
    const slowLuis = arrival(luis, new Date(t(5).getTime() - 60_000), 60_000);
    const slowAda = arrival(ada, new Date(t(30).getTime() - 60_000), 60_000);
    const stranger = arrival(uuidv7(), t(1));
    const r1 = await executeCommand(
      recordGuestArrivalsCommand,
      { eventId: s.eventId, arrivals: [fastLuis, fastAda] },
      fast.ctx(),
      ports,
    );
    expect(r1.results.map((r) => r.result)).toEqual(['arrived', 'arrived']);
    const r2 = await executeCommand(
      recordGuestArrivalsCommand,
      { eventId: s.eventId, arrivals: [slowLuis, slowAda, stranger] },
      slow.ctx(),
      ports,
    );
    expect(r2.results.map((r) => r.result)).toEqual(['arrived', 'already', 'unknown']);
    // Resent (both concurrently): nothing changes.
    const again = await Promise.all([
      executeCommand(
        recordGuestArrivalsCommand,
        { eventId: s.eventId, arrivals: [fastLuis, fastAda] },
        fast.ctx(),
        ports,
      ),
      executeCommand(
        recordGuestArrivalsCommand,
        { eventId: s.eventId, arrivals: [slowLuis, slowAda] },
        slow.ctx(),
        ports,
      ),
    ]);
    expect(again[0].results.map((r) => r.result)).toEqual(['already', 'arrived']);
    expect(again[1].results.map((r) => r.result)).toEqual(['arrived', 'already']);
    const rows = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ guest_id: string; arrived_at: Date; device_id: string; n: number }>(
        sql`select guest_id, arrived_at, device_id, count(*) over (partition by guest_id)::int as n
            from checkin.guest_arrivals where event_id = ${s.eventId} order by arrived_at`,
      ),
    );
    const byGuest = new Map([...rows].map((r) => [r.guest_id, r]));
    expect([...rows].every((r) => r.n === 1)).toBe(true);
    expect(new Date(byGuest.get(luis)?.arrived_at ?? 0).toISOString()).toBe(t(5).toISOString());
    expect(byGuest.get(luis)?.device_id).toBe(slow.deviceId);
    expect(new Date(byGuest.get(ada)?.arrived_at ?? 0).toISOString()).toBe(t(20).toISOString());
    // The next snapshot carries the arrivals.
    const snap = await executeQuery(guestSnapshotQuery, { eventId: s.eventId }, fast.ctx(), ports);
    expect(snap.parties.flatMap((p) => p.guests).find((g) => g.id === ada)?.arrivedAt).toBe(
      t(20).toISOString(),
    );
  });

  it('a device clock in the future never dates an arrival after now', async () => {
    const d = await enroll(a, 'Future clock');
    const kofi = s.ids['Kofi Okafor'] ?? '';
    await executeCommand(
      recordGuestArrivalsCommand,
      { eventId: s.eventId, arrivals: [arrival(kofi, new Date(NOW.getTime() + 3_600_000))] },
      d.ctx(),
      ports,
    );
    const day = await executeQuery(dayOfQuery, { eventId: s.eventId }, a.ctx({ now: NOW }), ports);
    expect(day.arrivals.find((x) => x.guestId === kofi)?.arrivedAt.getTime()).toBeLessThanOrEqual(
      NOW.getTime(),
    );
    await executeCommand(undoGuestArrivalCommand, { eventId: s.eventId, guestId: kofi }, a.ctx(), ports);
  });
});

describe('the host: day-of view, check-in and undo', () => {
  it('counts arrivals, unseated guests and meals; marks and undoes arrivals', async () => {
    const ana = s.ids['Ana García'] ?? '';
    const r = await executeCommand(
      markGuestsArrivedCommand,
      { eventId: s.eventId, guestIds: [ana, s.plusOne] },
      a.ctx(),
      ports,
    );
    expect(r.arrived + r.already).toBe(2);
    const day = await executeQuery(dayOfQuery, { eventId: s.eventId }, a.ctx(), ports);
    expect(day.timezone).toBe('America/Chicago');
    expect(day.counts).toMatchObject({ attending: 2, declined: 1, pending: 3, expected: 5 });
    expect(day.hasChart).toBe(true);
    expect(day.unseated.map((u) => u.name)).toEqual(['Kofi Okafor']);
    expect(day.counts.unseated).toBe(1);
    expect(day.meals).toEqual([
      { meal: 'Beef', guests: 1, arrived: 1 },
      { meal: 'Fish', guests: 1, arrived: 1 },
    ]);
    const anaRow = day.arrivals.find((x) => x.guestId === ana);
    expect(anaRow).toMatchObject({
      name: 'Ana García',
      partyName: 'Garcia',
      places: [{ chart: null, kind: 'table', label: '1' }],
    });
    expect(day.arrivals.find((x) => x.guestId === s.plusOne)).toMatchObject({
      name: null,
      guestOf: 'Luis López',
    });
    expect(day.counts.arrived).toBe(day.arrivals.length);
    expect(day.counts.notArrived).toBe(
      day.counts.expected - day.arrivals.filter((x) => x.name !== 'Mei Chen').length,
    );

    const undone = await executeCommand(
      undoGuestArrivalCommand,
      { eventId: s.eventId, guestId: s.plusOne },
      a.ctx(),
      ports,
    );
    expect(undone.undone).toBe(true);
    await expect(
      executeCommand(undoGuestArrivalCommand, { eventId: s.eventId, guestId: s.plusOne }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Marking twice is "already"; a guest of another event is refused.
    const twice = await executeCommand(
      markGuestsArrivedCommand,
      { eventId: s.eventId, guestIds: [ana] },
      a.ctx(),
      ports,
    );
    expect(twice).toEqual({ arrived: 0, already: 1 });
    await expect(
      executeCommand(markGuestsArrivedCommand, { eventId: s.eventId, guestIds: [uuidv7()] }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('viewers read the day-of view but may not check guests in; door staff may; another org sees nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(executeQuery(dayOfQuery, { eventId: s.eventId }, viewer, ports)).resolves.toBeTruthy();
    await expect(
      executeCommand(
        markGuestsArrivedCommand,
        { eventId: s.eventId, guestIds: [s.ids['Kofi Okafor'] ?? ''] },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        undoGuestArrivalCommand,
        { eventId: s.eventId, guestId: s.ids['Ana García'] ?? '' },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const scanner = await member('scanner');
    await expect(
      executeCommand(
        markGuestsArrivedCommand,
        { eventId: s.eventId, guestIds: [s.ids['Kofi Okafor'] ?? ''] },
        userCtx(scanner, a.org.id),
        ports,
      ),
    ).resolves.toEqual({ arrived: 1, already: 0 });
    await expect(executeQuery(dayOfQuery, { eventId: s.eventId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(
        markGuestsArrivedCommand,
        { eventId: s.eventId, guestIds: [s.ids['Kofi Okafor'] ?? ''] },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it("each org's wedding is its own: org A can't read org B's day-of view", async () => {
    const other = await guestCheckinScenario(b.org.id, { ctx: b.ctx() });
    const day = await executeQuery(dayOfQuery, { eventId: other.eventId }, b.ctx(), ports);
    expect(day.hasChart).toBe(true);
    // Org B's own event is its own: org A can't read it.
    await expect(executeQuery(dayOfQuery, { eventId: other.eventId }, a.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('kiosk kinds (guest kiosk and the A–Z board)', () => {
  it('a kiosk operator starts a guest kiosk and a board; the heartbeat hands each its kind', async () => {
    const op = await member('viewer');
    await executeCommand(
      assignEventRoleCommand,
      { eventId: s.eventId, userId: op, role: 'kiosk_operator' },
      a.ctx(),
      ports,
    );
    const kiosk = await enroll(a, 'Guest kiosk');
    const board = await enroll(a, 'TV board');
    const opCtx = userCtx(op, a.org.id);
    await executeCommand(
      startKioskCommand,
      { eventId: s.eventId, deviceId: kiosk.deviceId, checkpointId: null, pin: '2468', kind: 'guests' },
      opCtx,
      ports,
    );
    await executeCommand(
      startKioskCommand,
      { eventId: s.eventId, deviceId: board.deviceId, checkpointId: null, pin: '1357', kind: 'board' },
      opCtx,
      ports,
    );
    const beat = (d: { ctx: () => Ctx }) =>
      executeCommand(
        heartbeatCommand,
        { batteryPct: 90, queueDepth: 0, clockOffsetMs: 0, eventId: s.eventId },
        d.ctx(),
        ports,
      );
    expect((await beat(kiosk)).kiosk).toMatchObject({ eventId: s.eventId, kind: 'guests' });
    expect((await beat(board)).kiosk).toMatchObject({ kind: 'board', checkpointId: null });
    const view = await executeQuery(
      supervisorViewQuery(derivedStaffAlerts),
      { eventId: s.eventId },
      opCtx,
      ports,
    );
    expect(view.devices.find((x) => x.id === board.deviceId)?.kioskKind).toBe('board');
    // Default: tickets (M3.4a), and the board stands at no entrance.
    await executeCommand(stopKioskCommand, { eventId: s.eventId, deviceId: kiosk.deviceId }, opCtx, ports);
    expect((await beat(kiosk)).kiosk).toBeNull();
    expect(view.devices.find((x) => x.id === kiosk.deviceId)?.kioskKind).toBe('guests');
    await executeCommand(
      startKioskCommand,
      { eventId: s.eventId, deviceId: kiosk.deviceId, checkpointId: null, pin: '2468' },
      opCtx,
      ports,
    );
    expect((await beat(kiosk)).kiosk?.kind).toBe('tickets');
    const audit = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: { kind?: string; pin?: string } }>(
        sql`select data from platform.audit_events where action = 'device.kiosk_start' and target_id = ${board.deviceId}`,
      ),
    );
    expect(audit[0]?.data.kind).toBe('board');
    expect(JSON.stringify(audit)).not.toContain('1357');
    // A viewer can't start one.
    await expect(
      executeCommand(
        startKioskCommand,
        { eventId: s.eventId, deviceId: board.deviceId, checkpointId: null, pin: '1357', kind: 'board' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a kiosk device syncs guest arrivals as a kiosk', async () => {
    const d = await enroll(a, 'Kiosk sync');
    const kofi = s.ids['Kofi Okafor'] ?? '';
    await executeCommand(
      undoGuestArrivalCommand,
      { eventId: s.eventId, guestId: kofi },
      a.ctx(),
      ports,
    ).catch(() => undefined);
    const r = await executeCommand(
      recordGuestArrivalsCommand,
      { eventId: s.eventId, arrivals: [{ ...arrival(kofi, NOW), source: 'kiosk' }] },
      d.ctx(),
      ports,
    );
    expect(r.results[0]?.result).toBe('arrived');
    const day = await executeQuery(dayOfQuery, { eventId: s.eventId }, createCtx({ ...a.ctx() }), ports);
    expect(day.arrivals.find((x) => x.guestId === kofi)?.source).toBe('kiosk');
  });
});
