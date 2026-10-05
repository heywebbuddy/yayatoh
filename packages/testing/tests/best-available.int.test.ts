import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow, type FloorplanDoc } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { recordBoxOfficeSaleCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  assignSeatCategoryCommand,
  eventSeatingQuery,
  holdBestAvailableCommand,
  holdBestAvailableStaffCommand,
  holdIdForToken,
  holdSeatsTx,
  isTogether,
  publicSeatMap,
  publishEventLayoutCommand,
  releaseBestAvailableCommand,
  type SeatingRuleDto,
  selectionPageQuery,
  setCompanionSeatsCommand,
  setEventLayoutCommand,
  setSeatingRulesCommand,
  setSelectionSettingsCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;
const FRONT = '01922c3e-0000-7000-8000-000000000001';
const BACK = '01922c3e-0000-7000-8000-000000000002';

interface Seated {
  id: string;
  tt: string;
  rows: ReturnType<typeof buildRow>[];
  seat: (row: number, i: number) => string;
}

/**
 * A published event with a stage at the top and rows of seats under it (row 0 nearest), every
 * seat priced at one ticket type. `accessible` marks seats per row (e.g. `{ 2: [0, 9] }`).
 */
async function seatedEvent(
  name: string,
  rows: number,
  perRow: number,
  opts: { accessible?: Record<number, number[]>; startsAt?: string; sections?: boolean } = {},
): Promise<Seated> {
  const startsAt = opts.startsAt ?? '2029-09-01T19:00:00Z';
  const id = (
    await executeCommand(
      createEventCommand,
      {
        name: `${name} ${RUN}`,
        timezone: 'UTC',
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3 * 3_600_000).toISOString(),
      },
      a.ctx(),
      ports,
    )
  ).id;
  const tt = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: id, name: 'Seat', priceMinor: 2000, quantityTotal: 2_000 },
      a.ctx(),
      ports,
    )
  ).id;
  const built = Array.from({ length: rows }, (_, r) => {
    const row = buildRow({ label: String.fromCharCode(65 + r), count: perRow, x: 200, y: 600 + r * 90 });
    for (const i of opts.accessible?.[r] ?? [])
      row.seats[i] = { ...(row.seats[i] as (typeof row.seats)[number]), accessible: true };
    return opts.sections ? { ...row, sectionId: r < rows / 2 ? FRONT : BACK } : row;
  });
  const doc: FloorplanDoc = {
    version: 1,
    width: 4000,
    height: 600 + rows * 90 + 400,
    underlay: null,
    sections: opts.sections
      ? [
          { id: FRONT, label: 'Front', vip: false },
          { id: BACK, label: 'Back', vip: false },
        ]
      : [],
    items: [
      {
        kind: 'object',
        id: uuidv7(),
        objectType: 'stage',
        label: 'Stage',
        x: 200 + ((perRow - 1) * 50) / 2 - 300,
        y: 100,
        width: 600,
        height: 300,
        rotation: 0,
      },
      ...built,
    ],
  };
  await executeCommand(setEventLayoutCommand, { eventId: id, doc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId: id, itemIds: built.map((r) => r.id), ticketTypeId: tt },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, a.ctx(), ports);
  await executeCommand(publishEventLayoutCommand, { eventId: id }, a.ctx(), ports);
  return { id, tt, rows: built, seat: (r, i) => built[r]?.seats[i]?.id ?? '' };
}

const buyer = (orgId = a.org.id, now?: Date): Ctx => ({
  ...createCtx({ orgId }),
  ...(now ? { now } : {}),
});
const offer = (ev: Seated, on = true, sectionScores: Record<string, number> = {}, ctx = a.ctx()) =>
  executeCommand(
    setSelectionSettingsCommand,
    { eventId: ev.id, bestAvailable: on, sectionScores },
    ctx,
    ports,
  );
const best = (ev: Seated, quantity: number, more: Record<string, unknown> = {}, ctx = buyer()) =>
  executeCommand(
    holdBestAvailableCommand,
    { eventId: ev.id, ticketTypeId: ev.tt, quantity, ...more },
    ctx,
    ports,
  );
const setRules = (ev: Seated, rules: SeatingRuleDto[]) =>
  executeCommand(setSeatingRulesCommand, { eventId: ev.id, rules }, a.ctx(), ports);
const statusOf = async (ev: Seated) =>
  new Map(
    ((await executeQuery(eventSeatingQuery, { eventId: ev.id }, a.ctx(), ports))?.seats ?? []).map((s) => [
      s.seatUuid,
      s.status,
    ]),
  );
const checkout = (ev: Seated, extra: Record<string, unknown>, who = `ba-${uuidv7().slice(-6)}`) =>
  executeCommand(
    startCheckoutCommand,
    { eventId: ev.id, items: [], buyer: { email: `${who}@best.test`, name: who }, ...extra },
    buyer(),
    ports,
  );
/** The seats an order holds or bought (orders.seat_uuids; the DTO leaves them out). */
const orderSeats = async (orderId: string) =>
  (
    await withTenant(a.ctx(), (tx) =>
      tx.execute<{ seat_uuids: string[] }>(sql`select seat_uuids from orders.orders where id = ${orderId}`),
    )
  )[0]?.seat_uuids ?? [];
/** Take seats by hand (a buyer choosing them), to shape what is left. */
const take = (ev: Seated, seatUuids: string[]) =>
  withTenant(a.ctx(), (tx) =>
    holdSeatsTx(tx, a.ctx(), {
      eventId: ev.id,
      seatUuids,
      holdId: uuidv7(),
      expiresAt: new Date(Date.now() + 600_000),
    }),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('best available (M6.11a)', () => {
  it('is off until the organizer offers it; only seating writers may; viewers read', async () => {
    const ev = await seatedEvent('Offer', 2, 10, { sections: true });
    await expect(best(ev, 2)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'best_available_off' },
    });
    await expect(offer(ev, true, {}, userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(offer(ev, true, { [uuidv7()]: 50 })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'unknown_section', field: 'sectionScores' },
    });
    await expect(offer(ev, true, { [FRONT]: 101 })).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await offer(ev, true, { [BACK]: 80 })).toEqual({
      bestAvailable: true,
      sectionScores: { [BACK]: 80 },
    });
    const page = await executeQuery(
      selectionPageQuery,
      { eventId: ev.id },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    expect(page.settings).toEqual({ bestAvailable: true, sectionScores: { [BACK]: 80 } });
    expect(page.sections.map((s) => s.label)).toEqual(['Front', 'Back']);
    // The public map says so (with the module), and the scores never leave the console.
    const map = await publicSeatMap(a.org.id, ev.id, { advancedSeating: true });
    expect(map?.bestAvailable).toBe(true);
    expect(JSON.stringify(map)).not.toContain('sectionScores');
    expect(JSON.stringify(map)).not.toContain('score');
    // Without advanced seating the map is what it always was.
    expect(Object.keys((await publicSeatMap(a.org.id, ev.id)) ?? {}).sort()).toEqual([
      'doc',
      'rules',
      'seats',
      'startsAt',
    ]);
    // The organizer's score wins over distance to the stage: the back section first.
    const held = await best(ev, 2);
    expect(held.pieces).toBe(1);
    expect(held.seats.every((s) => ev.rows[1]?.seats.some((x) => x.id === s.seatUuid))).toBe(true);
    expect(held.seats.map((s) => s.label)).toEqual(['Row B · 5', 'Row B · 6']);
  });

  it('holds the best block, which checkout takes over; the token works once', async () => {
    const ev = await seatedEvent('Buy four', 3, 10);
    await offer(ev);
    const held = await best(ev, 4);
    // Nearest the stage, centre of the row.
    expect(held.seats.map((s) => s.label)).toEqual(['Row A · 4', 'Row A · 5', 'Row A · 6', 'Row A · 7']);
    expect(held.pieces).toBe(1);
    expect(held.expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    const states = await statusOf(ev);
    for (const s of held.seats) expect(states.get(s.seatUuid)).toBe('held');
    const { order } = await checkout(ev, { seatHold: held.token });
    expect(order.status).toBe('reserved');
    expect((await orderSeats(order.id)).sort()).toEqual(held.seats.map((s) => s.seatUuid).sort());
    expect(order.items).toEqual([expect.objectContaining({ ticketTypeId: ev.tt, quantity: 4 })]);
    // The seats are the order's now: the token is spent.
    await expect(checkout(ev, { seatHold: held.token })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'seat_hold_expired' },
    });
    // Choosing both ways at once is refused.
    const again = await best(ev, 1);
    await expect(checkout(ev, { seatHold: again.token, seats: [ev.seat(2, 0)] })).rejects.toMatchObject({
      details: { reason: 'choose_seats' },
    });
    // An unknown or lapsed token never adopts anything.
    await expect(checkout(ev, { seatHold: 'x'.repeat(32) })).rejects.toMatchObject({
      details: { reason: 'seat_hold_expired' },
    });
  });

  it('never splits a party when a block fits; splits only when none does, and says so', async () => {
    const ev = await seatedEvent('Split', 2, 8);
    await offer(ev);
    // Row A: free seats 1–3 and 6–8 only; row B: 4 free together in the middle.
    await take(
      ev,
      [3, 4].map((i) => ev.seat(0, i)),
    );
    await take(
      ev,
      [0, 1, 6, 7].map((i) => ev.seat(1, i)),
    );
    const four = await best(ev, 4);
    expect(four.pieces).toBe(1);
    expect(four.seats.map((s) => s.label)).toEqual(['Row B · 3', 'Row B · 4', 'Row B · 5', 'Row B · 6']);
    // Now only pieces of three are left in row A: five people are split in two, never more.
    const five = await best(ev, 5);
    expect(five.pieces).toBe(2);
    expect(five.seats).toHaveLength(5);
    await expect(best(ev, 2)).rejects.toMatchObject({ details: { reason: 'not_enough_seats' } });
  });

  it('a released hold frees its seats; tokens never touch an order’s seats', async () => {
    const ev = await seatedEvent('Release', 1, 6);
    await offer(ev);
    const held = await best(ev, 2);
    const { order } = await checkout(ev, { seats: [ev.seat(0, 0)] });
    expect(holdIdForToken(held.token)).not.toBe(order.id);
    expect(
      (
        await executeCommand(
          releaseBestAvailableCommand,
          { eventId: ev.id, token: 'y'.repeat(32) },
          buyer(),
          ports,
        )
      ).released,
    ).toBe(0);
    expect(
      (
        await executeCommand(
          releaseBestAvailableCommand,
          { eventId: ev.id, token: held.token },
          buyer(),
          ports,
        )
      ).released,
    ).toBe(2);
    const states = await statusOf(ev);
    for (const s of held.seats) expect(states.get(s.seatUuid)).toBe('available');
    expect(states.get(ev.seat(0, 0))).toBe('held');
    // Choosing again gives the previous hold back first.
    const first = await best(ev, 3);
    const second = await best(ev, 3, { replaceToken: first.token });
    expect(second.seats.map((s) => s.seatUuid).sort()).toEqual(first.seats.map((s) => s.seatUuid).sort());
  });

  it('no seat is ever held twice under 100 concurrent requests (with buyers choosing by hand too)', async () => {
    const ev = await seatedEvent('Rush', 10, 25);
    await offer(ev);
    const sizes = Array.from({ length: 100 }, (_, i) => 1 + (i % 4));
    const manual = Array.from({ length: 20 }, (_, i) => [ev.seat(i % 10, (i * 7) % 25)]);
    const [held, hand] = await Promise.all([
      Promise.allSettled(sizes.map((n) => best(ev, n))),
      Promise.allSettled(manual.map((seats) => take(ev, seats))),
    ]);
    const ok = held.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    for (const r of held)
      if (r.status === 'rejected')
        expect(['not_enough_seats', 'seats_taken']).toContain(
          (r.reason as { details?: { reason?: string } }).details?.reason,
        );
    const chosen = ok.flatMap((h) => h.seats.map((s) => s.seatUuid));
    expect(new Set(chosen).size).toBe(chosen.length);
    const manualOk = hand.flatMap((r, i) => (r.status === 'fulfilled' ? (manual[i] as string[]) : []));
    for (const id of manualOk) expect(chosen).not.toContain(id);
    // The database agrees: every chosen seat is held under its own hold, exactly once.
    const rows = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ hold_id: string; n: number }>(
        sql`select hold_id, count(*)::int as n from seating.event_seats where event_id = ${ev.id} and status = 'held' group by hold_id`,
      ),
    );
    const total = rows.reduce((n, r) => n + Number(r.n), 0);
    expect(total).toBe(chosen.length + manualOk.length);
    for (const h of ok) {
      const row = rows.find((r) => r.hold_id === holdIdForToken(h.token));
      expect(Number(row?.n)).toBe(h.seats.length);
    }
    // Most parties sat together (250 seats for ~250 people).
    expect(ok.filter((h) => h.pieces === 1).length).toBeGreaterThan(50);
  }, 120_000);

  it('isolation: another org can neither see nor hold this org’s seats', async () => {
    const ev = await seatedEvent('Isolated', 1, 6);
    await offer(ev);
    await expect(
      executeCommand(
        holdBestAvailableCommand,
        { eventId: ev.id, ticketTypeId: ev.tt, quantity: 2 },
        buyer(b.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(executeQuery(selectionPageQuery, { eventId: ev.id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(setSelectionSettingsCommand, { eventId: ev.id, bestAvailable: false }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A token from org A releases nothing in org B.
    const held = await best(ev, 2);
    const released = await executeCommand(
      releaseBestAvailableCommand,
      { eventId: ev.id, token: held.token },
      buyer(b.org.id),
      ports,
    );
    expect(released.released).toBe(0);
    expect((await statusOf(ev)).get(held.seats[0]?.seatUuid ?? '')).toBe('held');
    // B's own fixture event offers best available and keeps its companion seat to itself.
    const rows = await withTenant(b.ctx(), (tx) =>
      tx.execute<{ org_id: string }>(sql`select org_id from seating.companion_seats`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === b.org.id)).toBe(true);
  });

  it('needs the advanced_seating module', async () => {
    const ev = await seatedEvent('Module', 1, 6);
    await offer(ev);
    const off = { moduleKey: 'advanced_seating', reason: 'test' } as const;
    await executeCommand(
      setEntitlementOverrideCommand,
      { ...off, effect: 'revoke' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(best(ev, 2)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(offer(ev, false)).rejects.toMatchObject({ code: 'module_not_enabled' });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { ...off, effect: 'grant' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

describe('ADA engine (M6.11a, D18)', () => {
  // Row A (front): no accessible seats. Row B: accessible seats at both ends.
  let ev: Seated;
  const comp = () => [ev.seat(1, 1), ev.seat(1, 8)];
  beforeAll(async () => {
    ev = await seatedEvent('Access', 2, 10, { accessible: { 1: [0, 9] } });
    await offer(ev);
  });

  it('companion seats sit next to accessible seats; the engine suggests them', async () => {
    const page = await executeQuery(selectionPageQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(page.groups.map((g) => g.label)).toEqual(['B']);
    const suggested = page.groups[0]?.seats.filter((s) => s.suggested).map((s) => s.seatUuid);
    expect(suggested?.sort()).toEqual(comp().sort());
    const set = (seatUuids: string[], ctx = a.ctx()) =>
      executeCommand(setCompanionSeatsCommand, { eventId: ev.id, seatUuids }, ctx, ports);
    await expect(set([ev.seat(1, 0)])).rejects.toMatchObject({
      details: { reason: 'companion_is_accessible' },
    });
    await expect(set([ev.seat(0, 4)])).rejects.toMatchObject({ details: { reason: 'companion_far' } });
    await expect(set(comp(), userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await set(comp())).toEqual({ count: 2 });
    const after = await executeQuery(selectionPageQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.companionCount).toBe(2);
    expect(
      after.groups[0]?.seats
        .filter((s) => s.companion)
        .map((s) => s.seatUuid)
        .sort(),
    ).toEqual(comp().sort());
    const map = await publicSeatMap(a.org.id, ev.id, { advancedSeating: true });
    expect(
      map?.seats
        .filter((s) => s.companion)
        .map((s) => s.seatUuid)
        .sort(),
    ).toEqual(comp().sort());
  });

  it('enforced: a companion seat is sold only with an accessible seat; the buyer’s statement unlocks kept-back seats', async () => {
    await setRules(ev, [
      { kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 7 } },
      { kind: 'ada_companion', severity: 'enforce', params: { maxPerAccessible: 1 } },
    ]);
    // By hand: a companion seat alone is refused, and so is an accessible seat without the statement.
    await expect(checkout(ev, { seats: [ev.seat(1, 1)] })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'seat_rule', rule: 'ada_companion', overridable: false },
    });
    await expect(checkout(ev, { seats: [ev.seat(1, 0), ev.seat(1, 1)] })).rejects.toMatchObject({
      details: { reason: 'seat_rule', rule: 'ada_reserved' },
    });
    // Two companions for one accessible seat: over the limit.
    await expect(
      checkout(ev, { seats: [ev.seat(1, 0), ev.seat(1, 1), ev.seat(1, 8)], accessibleNeed: true }),
    ).rejects.toMatchObject({ details: { reason: 'seat_rule', rule: 'ada_companion' } });
    // Nothing stayed held after the refusals.
    const states = await statusOf(ev);
    expect([0, 1, 8, 9].map((i) => states.get(ev.seat(1, i)))).toEqual(Array(4).fill('available'));
    // With the statement: the accessible seat and its companion.
    const { order } = await checkout(ev, { seats: [ev.seat(1, 0), ev.seat(1, 1)], accessibleNeed: true });
    expect(await orderSeats(order.id)).toHaveLength(2);
  });

  it('best available keeps accessible and companion seats for those who need them, and seats a wheelchair user with a companion', async () => {
    // Everyone else: never the kept-back seats, even with the front row full.
    await take(
      ev,
      Array.from({ length: 10 }, (_, i) => ev.seat(0, i)),
    );
    const two = await best(ev, 2);
    expect(two.seats.some((s) => s.accessible || s.companion)).toBe(false);
    // Six left in row B that are not accessible or companion (2–7 minus the two just held).
    await expect(best(ev, 6)).rejects.toMatchObject({ details: { reason: 'not_enough_seats' } });
    // A party with a wheelchair user: the free accessible seat (B10) and its companion (B9).
    const party = await best(ev, 2, { accessible: true });
    expect(party.pieces).toBe(1);
    expect(party.seats.map((s) => [s.label, s.accessible, s.companion])).toEqual([
      ['Row B · 9', false, true],
      ['Row B · 10', true, false],
    ]);
    const { order } = await checkout(ev, { seatHold: party.token, accessibleNeed: true });
    expect(await orderSeats(order.id)).toHaveLength(2);
    // No accessible seat left: the request says so.
    await expect(best(ev, 1, { accessible: true })).rejects.toMatchObject({
      details: { reason: 'no_accessible_seat' },
    });
  });

  it('the box office: staff say the buyer needs the seat, or override an enforced rule on purpose', async () => {
    const door = await seatedEvent('Door access', 1, 6, { accessible: { 0: [0] } });
    await offer(door);
    await executeCommand(
      setCompanionSeatsCommand,
      { eventId: door.id, seatUuids: [door.seat(0, 1)] },
      a.ctx(),
      ports,
    );
    await setRules(door, [{ kind: 'ada_companion', severity: 'enforce', params: { maxPerAccessible: 1 } }]);
    const sell = (extra: Record<string, unknown>) =>
      executeCommand(
        recordBoxOfficeSaleCommand,
        { eventId: door.id, buyer: { email: 'door@best.test', name: 'Door' }, method: 'cash', ...extra },
        a.ctx(),
        ports,
      );
    await expect(sell({ seats: [door.seat(0, 1)] })).rejects.toMatchObject({
      details: { reason: 'seat_rule', rule: 'ada_companion', overridable: true },
    });
    const forced = await sell({ seats: [door.seat(0, 1)], overrideRules: true });
    expect(forced.warnings).toEqual([
      expect.objectContaining({ rule: 'ada_companion', severity: 'enforce' }),
    ]);
    // Best available at the door, for a wheelchair user.
    const staff = await executeCommand(
      holdBestAvailableStaffCommand,
      { eventId: door.id, ticketTypeId: door.tt, quantity: 1, accessible: true },
      a.ctx(),
      ports,
    );
    expect(staff.seats.map((s) => s.label)).toEqual(['Row A · 1']);
    const sale = await sell({ seatHold: staff.token, accessibleNeed: true });
    expect(await orderSeats(sale.order.id)).toEqual([door.seat(0, 0)]);
    // Viewers can't sell.
    await expect(
      executeCommand(
        holdBestAvailableStaffCommand,
        { eventId: door.id, ticketTypeId: door.tt, quantity: 1 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('kept-back seats are released at the configured time: then anyone may have them', async () => {
    const soon = await seatedEvent('Release time', 1, 4, {
      accessible: { 0: [0, 1, 2, 3] },
      startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    await offer(soon);
    await executeCommand(
      setSeatingRulesCommand,
      {
        eventId: soon.id,
        rules: [{ kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 7 } }],
      },
      a.ctx(),
      ports,
    );
    // Released already (the event is 3 days away, release was 7 days before).
    const held = await best(soon, 2);
    expect(held.seats.every((s) => s.accessible)).toBe(true);
    // Before release (a month earlier), nothing is free for the general public.
    const early = new Date(Date.now() - 30 * 86_400_000);
    await expect(best(soon, 2, {}, buyer(a.org.id, early))).rejects.toMatchObject({
      details: { reason: 'not_enough_seats' },
    });
    expect(isTogether([])).toBe(true);
  });
});
