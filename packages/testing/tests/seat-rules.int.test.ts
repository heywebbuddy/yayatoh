import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  eventSeatingQuery,
  publicSeatMap,
  publishEventLayoutCommand,
  type SeatingRuleDto,
  seatingRulesQuery,
  setEventLayoutCommand,
  setSeatingRulesCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/** Event names are unique per run (slugs are global; other suites create similar events). */
const RUN = uuidv7().slice(-8);
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let soonId: string;
let plainId: string;
let tt: string;
// Row A: seats 1–2 are accessible. Table 1: seat 1 is accessible.
const row = buildRow({ label: 'A', count: 8, x: 100, y: 100 });
for (const i of [0, 1]) row.seats[i] = { ...(row.seats[i] as (typeof row.seats)[number]), accessible: true };
const table = buildRoundTable({ label: '1', seats: 3, x: 700, y: 600 });
table.seats[0] = { ...(table.seats[0] as (typeof table.seats)[number]), accessible: true };
const doc = { version: 1, width: 1200, height: 1000, items: [row, table] };
const seat = (i: number) => row.seats[i]?.id ?? '';

const setRules = (rules: SeatingRuleDto[], ctx = a.ctx(), ev = eventId) =>
  executeCommand(setSeatingRulesCommand, { eventId: ev, rules }, ctx, ports);
const checkout = (seats: string[], who: string, ev = eventId) =>
  executeCommand(
    startCheckoutCommand,
    { eventId: ev, items: [], seats, buyer: { email: `${who}@rules.test`, name: who } },
    createCtx({ orgId: a.org.id }),
    ports,
  );
const guest = async (name: string) =>
  (
    await executeCommand(
      addGuestCommand,
      { eventId, name, email: `${name.toLowerCase()}@rules.test` },
      a.ctx(),
      ports,
    )
  ).id;
const statusOf = async (s: string, ev = eventId) =>
  (await executeQuery(eventSeatingQuery, { eventId: ev }, a.ctx(), ports))?.seats.find(
    (x) => x.seatUuid === s,
  )?.status;

async function seatedEvent(name: string, startsAt: string) {
  const id = (
    await executeCommand(
      createEventCommand,
      {
        name,
        timezone: 'UTC',
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 4 * 3_600_000).toISOString(),
      },
      a.ctx(),
      ports,
    )
  ).id;
  const type = (
    await executeCommand(
      createTicketTypeCommand,
      { eventId: id, name: 'Seat', priceMinor: 2500, quantityTotal: 40 },
      a.ctx(),
      ports,
    )
  ).id;
  await executeCommand(setEventLayoutCommand, { eventId: id, doc }, a.ctx(), ports);
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId: id, itemIds: [row.id, table.id], ticketTypeId: type },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId: id }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, a.ctx(), ports);
  return { id, type };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ({ id: eventId, type: tt } = await seatedEvent(`Rules gala ${RUN}`, '2029-05-20T18:00:00Z'));
  // An event two days away: a rule releasing accessible seats a week before is already released.
  ({ id: soonId } = await seatedEvent(
    `Soon gala ${RUN}`,
    new Date(Date.now() + 2 * 86_400_000).toISOString(),
  ));
  plainId = (
    await executeCommand(
      createEventCommand,
      {
        name: `No plan ${RUN}`,
        timezone: 'UTC',
        startsAt: '2029-05-21T18:00:00Z',
        endsAt: '2029-05-21T20:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
});
afterAll(closePools);

describe('seating rules (M1.7f)', () => {
  it('an organizer sets, reads and switches off rules; warn is the default', async () => {
    expect(await executeQuery(seatingRulesQuery, { eventId }, a.ctx(), ports)).toEqual([]);
    const saved = await setRules([
      { kind: 'max_per_order_seats', severity: 'warn', params: { max: 4 } },
      { kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 14 } },
    ]);
    expect(saved).toEqual([
      { kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 14 } },
      { kind: 'max_per_order_seats', severity: 'warn', params: { max: 4 } },
    ]);
    // Replacing keeps only what is sent.
    expect(await setRules([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } }])).toEqual([
      { kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } },
    ]);
    expect(
      await executeQuery(seatingRulesQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).toHaveLength(1);
    expect(await setRules([])).toEqual([]);
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: { rules: unknown[] } }>(
        sql`select data from platform.audit_events where action = 'seating.rules_set' and target_id = ${eventId} order by created_at desc limit 1`,
      ),
    );
    expect(audit?.data.rules).toEqual([]);
  });

  it('refuses bad input, a second rule of a kind, events without a plan, viewers and other orgs', async () => {
    await expect(
      setRules([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 400 } }]),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      setRules([{ kind: 'max_per_order_seats', severity: 'warn', params: { max: 0 } }]),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      setRules([
        { kind: 'max_per_order_seats', severity: 'warn', params: { max: 2 } },
        { kind: 'max_per_order_seats', severity: 'enforce', params: { max: 3 } },
      ]),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        setSeatingRulesCommand,
        { eventId, rules: [{ kind: 'nope', severity: 'warn', params: {} }] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      setRules([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 1 } }], a.ctx(), plainId),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      setRules(
        [{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 1 } }],
        userCtx(a.viewerId, a.org.id),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Org B can't see or set org A's event's rules (RLS: no floor plan there).
    await expect(
      setRules([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 1 } }], b.ctx()),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(seatingRulesQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });

  it('buyers see the rules on the public map (allowlisted), and enforced kept-back seats as taken', async () => {
    await setRules([
      { kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 7 } },
      { kind: 'max_per_order_seats', severity: 'warn', params: { max: 3 } },
    ]);
    const map = await publicSeatMap(a.org.id, eventId);
    expect(map?.rules).toEqual([
      { kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 7 } },
      { kind: 'max_per_order_seats', severity: 'warn', params: { max: 3 } },
    ]);
    expect(map?.startsAt).toEqual(new Date('2029-05-20T18:00:00Z'));
    expect(Object.keys(map ?? {}).sort()).toEqual(['doc', 'rules', 'seats', 'startsAt']);
    const s = (id: string) => map?.seats.find((x) => x.seatUuid === id);
    expect([s(seat(0))?.available, s(seat(1))?.available, s(seat(2))?.available]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('checkout: an enforced rule refuses (and holds nothing); a warning lets the buyer through', async () => {
    await expect(checkout([seat(0), seat(2)], 'ada-enforced')).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'seat_rule', rule: 'ada_reserved', overridable: false },
    });
    expect([await statusOf(seat(0)), await statusOf(seat(2))]).toEqual(['available', 'available']);
    await setRules([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } }]);
    await checkout([seat(0)], 'ada-warned');
    expect(await statusOf(seat(0))).toBe('held');
  });

  it('checkout: seats per order — enforced refuses over the cap, warn allows it', async () => {
    await setRules([{ kind: 'max_per_order_seats', severity: 'enforce', params: { max: 2 } }]);
    await expect(checkout([seat(3), seat(4), seat(5)], 'cap-enforced')).rejects.toMatchObject({
      details: { reason: 'seat_rule', rule: 'max_per_order_seats', max: 2 },
    });
    expect(await statusOf(seat(3))).toBe('available');
    await checkout([seat(3), seat(4)], 'cap-ok');
    await setRules([{ kind: 'max_per_order_seats', severity: 'warn', params: { max: 2 } }]);
    await checkout([seat(5), seat(6), seat(7)], 'cap-warned');
    expect(await statusOf(seat(7))).toBe('held');
  });

  it('once released (N days before), accessible seats sell to anyone even when enforced', async () => {
    const soonRow = await publicSeatMap(a.org.id, soonId);
    const accessible = soonRow?.seats.find((s) => s.accessible)?.seatUuid ?? '';
    await setRules(
      [{ kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 7 } }],
      a.ctx(),
      soonId,
    );
    expect(
      (await publicSeatMap(a.org.id, soonId))?.seats.find((s) => s.seatUuid === accessible)?.available,
    ).toBe(true);
    await checkout([accessible], 'released', soonId);
    expect(await statusOf(accessible, soonId)).toBe('held');
  });

  it('assigning guests: a warning when an accessible seat is used while kept back', async () => {
    await setRules([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } }]);
    const ann = await guest('Ann');
    const r = await executeCommand(
      assignSeatsCommand,
      { eventId, attendeeIds: [ann], itemId: table.id, seatUuid: table.seats[0]?.id },
      a.ctx(),
      ports,
    );
    expect(r.warnings).toEqual([
      expect.objectContaining({ rule: 'ada_reserved', severity: 'warn', seats: [table.seats[0]?.id] }),
    ]);
    // Seats per order never applies to seating guests.
    await setRules([
      { kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } },
      { kind: 'max_per_order_seats', severity: 'enforce', params: { max: 1 } },
    ]);
    const [ben, cat] = [await guest('Ben'), await guest('Cat')];
    const both = await executeCommand(
      assignSeatsCommand,
      { eventId, attendeeIds: [ben, cat], itemId: table.id },
      a.ctx(),
      ports,
    );
    expect(both.seated).toHaveLength(2);
    expect(both.warnings).toEqual([]);
  });

  it('assigning guests when enforced: automatic placement skips kept-back seats; choosing one needs the override', async () => {
    const t2 = buildRoundTable({ label: '2', seats: 2, x: 300, y: 700 });
    t2.seats[0] = { ...(t2.seats[0] as (typeof t2.seats)[number]), accessible: true };
    const ev = (await seatedEvent(`Enforced gala ${RUN}`, '2029-06-01T18:00:00Z')).id;
    await executeCommand(
      setEventLayoutCommand,
      { eventId: ev, doc: { ...doc, items: [t2] } },
      a.ctx(),
      ports,
    );
    await setRules([{ kind: 'ada_reserved', severity: 'enforce', params: { releaseDays: 7 } }], a.ctx(), ev);
    const add = async (n: string) =>
      (
        await executeCommand(
          addGuestCommand,
          { eventId: ev, name: n, email: `${n}@enforced.test` },
          a.ctx(),
          ports,
        )
      ).id;
    const [dee, eli] = [await add('dee'), await add('eli')];
    // Two guests, one ordinary seat left for automatic placement: they don't fit.
    await expect(
      executeCommand(
        assignSeatsCommand,
        { eventId: ev, attendeeIds: [dee, eli], itemId: t2.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not_enough_seats', fits: 1 } });
    const one = await executeCommand(
      assignSeatsCommand,
      { eventId: ev, attendeeIds: [dee], itemId: t2.id },
      a.ctx(),
      ports,
    );
    expect(one.seated[0]?.seatUuid).toBe(t2.seats[1]?.id);
    // The accessible seat, chosen: refused unless staff confirm the guest needs it.
    const choose = (overrideRules: boolean) =>
      executeCommand(
        assignSeatsCommand,
        { eventId: ev, attendeeIds: [eli], itemId: t2.id, seatUuid: t2.seats[0]?.id, overrideRules },
        a.ctx(),
        ports,
      );
    await expect(choose(false)).rejects.toMatchObject({
      details: { reason: 'seat_rule', rule: 'ada_reserved', overridable: true },
    });
    const ok = await choose(true);
    expect(ok.seated[0]?.seatUuid).toBe(t2.seats[0]?.id);
    // An override is still reported as what it was, and audited.
    expect(ok.warnings).toEqual([expect.objectContaining({ rule: 'ada_reserved', severity: 'enforce' })]);
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: { overrideRules?: boolean } }>(
        sql`select data from platform.audit_events where action = 'seating.assign' and target_id = ${ev} order by created_at desc limit 1`,
      ),
    );
    expect(audit?.data.overrideRules).toBe(true);
  });

  it('fixture rows exist for both orgs (isolation coverage) and each org sees only its own', async () => {
    for (const org of [a, b]) {
      const rules = await executeQuery(seatingRulesQuery, { eventId: org.event.id }, org.ctx(), ports);
      expect(rules).toEqual([{ kind: 'ada_reserved', severity: 'warn', params: { releaseDays: 7 } }]);
    }
    expect(await executeQuery(seatingRulesQuery, { eventId: a.event.id }, b.ctx(), ports)).toEqual([]);
    expect(tt).toBeTruthy();
  });
});
