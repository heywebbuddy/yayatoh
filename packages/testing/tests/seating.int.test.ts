import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { buildRoundTable, buildRow } from '@yayatoh/floorplan';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  assignSeatCategoryCommand,
  blockSeatsCommand,
  eventSeatingQuery,
  holdSeatsTx,
  listLayoutsQuery,
  publishEventLayoutCommand,
  releaseExpiredSeatHoldsTx,
  releaseSeatHoldTx,
  saveLayoutCommand,
  sellSeatsTx,
  setEventLayoutCommand,
  voidSeatTx,
} from '@yayatoh/seating';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
const rowA = buildRow({ label: 'A', count: 10, x: 100, y: 100 });
const table = buildRoundTable({ label: '1', seats: 8, x: 1500, y: 700 });
const doc = { version: 1, width: 3000, height: 1500, sections: [], items: [rowA, table] };
const seat = (i: number) => rowA.seats[i]?.id ?? '';

const hold = (seatUuids: string[], holdId = uuidv7(), expiresAt = new Date(Date.now() + 600_000)) =>
  withTenant(a.ctx(), (tx) => holdSeatsTx(tx, a.ctx(), { eventId, seatUuids, holdId, expiresAt }));
const seating = () => executeQuery(eventSeatingQuery, { eventId }, a.ctx(), ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Seated gala',
        timezone: 'UTC',
        startsAt: '2028-08-01T18:00:00Z',
        endsAt: '2028-08-01T23:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
});
afterAll(closePools);

describe('seating (M1.7a)', () => {
  it('saves floor plans only when they are valid', async () => {
    await expect(
      executeCommand(
        saveLayoutCommand,
        { name: 'Broken', doc: { version: 1, width: 10, height: 10, items: [rowA] } },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { problems: expect.any(Array) } });
    const l = await executeCommand(saveLayoutCommand, { name: 'Ballroom', doc }, a.ctx(), ports);
    expect(l.seatCount).toBe(18);
    expect((await executeQuery(listLayoutsQuery, {}, a.ctx(), ports)).some((x) => x.id === l.id)).toBe(true);
    await executeCommand(setEventLayoutCommand, { eventId, layoutId: l.id }, a.ctx(), ports);
    const s = await seating();
    expect(s?.status).toBe('draft');
    expect(s?.counts).toEqual({ available: 18, held: 0, sold: 0, assigned: 0, blocked: 0 });
    expect(s?.seats.find((x) => x.seatUuid === seat(0))?.label).toBe('Row A · 1');
  });

  it('editing keeps prices and blocks of seats that still exist', async () => {
    const tt = uuidv7();
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId, itemIds: [rowA.id], ticketTypeId: tt },
      a.ctx(),
      ports,
    );
    await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [seat(3)], reason: 'channel' },
      a.ctx(),
      ports,
    );
    const moved = { ...doc, items: [{ ...rowA, x: rowA.x + 10 }, table] };
    await executeCommand(setEventLayoutCommand, { eventId, doc: moved }, a.ctx(), ports);
    const s = await seating();
    expect(s?.seats.filter((x) => x.ticketTypeId === tt)).toHaveLength(10);
    expect(s?.seats.find((x) => x.seatUuid === seat(3))?.status).toBe('blocked');
    await executeCommand(blockSeatsCommand, { eventId, seatUuids: [seat(3)], reason: null }, a.ctx(), ports);
  });

  it('draft seats are not on sale; published ones are', async () => {
    await expect(hold([seat(0)])).rejects.toMatchObject({ details: { reason: 'seats_not_on_sale' } });
    await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
    const held = await hold([seat(0), seat(1)]);
    expect(held.map((h) => h.label).sort()).toEqual(['Row A · 1', 'Row A · 2']);
    // With seats held the plan cannot be replaced (and a plan on sale would stay on sale).
    await expect(
      executeCommand(setEventLayoutCommand, { eventId, doc }, a.ctx(), ports),
    ).rejects.toMatchObject({
      details: { reason: 'seats_in_use' },
    });
  });

  it('a seat race produces exactly one winner (ADR 0012 acceptance)', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => hold([seat(5), seat(6)])));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        code: 'conflict',
        details: { reason: 'seats_taken' },
      });
    // All or nothing: a hold that includes one taken seat moves no seat at all.
    await expect(hold([seat(6), seat(7)])).rejects.toMatchObject({ code: 'conflict' });
    expect((await seating())?.seats.find((x) => x.seatUuid === seat(7))?.status).toBe('available');
  });

  it('selling locks the layout; a locked layout cannot be replaced', async () => {
    const holdId = uuidv7();
    await hold([seat(8)], holdId);
    const ticketId = uuidv7();
    await withTenant(a.ctx(), (tx) =>
      sellSeatsTx(tx, a.ctx(), { eventId, holdId, tickets: [{ seatUuid: seat(8), ticketId }] }),
    );
    expect((await seating())?.status).toBe('locked');
    await expect(
      executeCommand(setEventLayoutCommand, { eventId, doc }, a.ctx(), ports),
    ).rejects.toMatchObject({
      details: { reason: 'layout_locked' },
    });
    // A voided ticket frees its seat.
    await withTenant(a.ctx(), (tx) => voidSeatTx(tx, a.ctx(), ticketId));
    expect((await seating())?.seats.find((x) => x.seatUuid === seat(8))?.status).toBe('available');
  });

  it('releases holds explicitly and by the sweeper', async () => {
    const holdId = uuidv7();
    await hold([seat(9)], holdId);
    expect(await withTenant(a.ctx(), (tx) => releaseSeatHoldTx(tx, a.ctx(), holdId))).toBe(1);
    await hold([seat(9)], uuidv7(), new Date(Date.now() - 1000));
    const released = await withTenant(a.ctx(), (tx) => releaseExpiredSeatHoldsTx(tx, a.ctx()));
    expect(released).toBeGreaterThanOrEqual(1);
    expect((await seating())?.seats.find((x) => x.seatUuid === seat(9))?.status).toBe('available');
  });

  it('prices and blocks seats by table, never touching sold ones', async () => {
    const ticketTypeId = uuidv7();
    const r = await executeCommand(
      assignSeatCategoryCommand,
      { eventId, itemIds: [table.id], ticketTypeId },
      a.ctx(),
      ports,
    );
    expect(r.updated).toBe(8);
    const blocked = await executeCommand(
      blockSeatsCommand,
      { eventId, seatUuids: [table.seats[0]?.id ?? '', seat(0)], reason: 'ada' },
      a.ctx(),
      ports,
    );
    // Seat A1 is held, so only the table seat is blocked.
    expect(blocked.updated).toBe(1);
    expect((await seating())?.counts.blocked).toBe(1);
    expect(
      (
        await executeCommand(
          blockSeatsCommand,
          { eventId, seatUuids: [table.seats[0]?.id ?? ''], reason: null },
          a.ctx(),
          ports,
        )
      ).updated,
    ).toBe(1);
  });

  it('viewers can look but not change; other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(eventSeatingQuery, { eventId }, viewer, ports))?.status).toBe('locked');
    await expect(
      executeCommand(blockSeatsCommand, { eventId, seatUuids: [seat(7)], reason: 'kill' }, viewer, ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await executeQuery(eventSeatingQuery, { eventId }, b.ctx(), ports)).toBeNull();
  });
});
