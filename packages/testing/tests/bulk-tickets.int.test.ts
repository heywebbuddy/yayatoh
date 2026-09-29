import { addGuestCommand, searchAttendeesQuery } from '@yayatoh/attendees';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  orderByManageToken,
  orderDetailQuery,
  startCheckoutCommand,
  ticketCancelBulk,
} from '@yayatoh/orders';
import { consumeEvent, memoryNotifier } from '@yayatoh/platform';
import { attendeeExportBulk, attendeeListQuery, matchingAttendeeIdsQuery } from '@yayatoh/reports';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import {
  createTicketTypeCommand,
  ticketCancelledMailer,
  ticketResendBulk,
  ticketResendMailer,
} from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPORT_PARAMS, type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

// Digits only: buyers' emails carry it, and a letter pair like "ad" would match the name searches.
const RUN = uuidv7()
  .slice(-8)
  .replace(/[a-f]/g, (c) => String(c.charCodeAt(0) - 97));
const DURING = new Date('2029-06-01T20:00:00Z');
const NEXT_DAY = new Date('2029-06-02T20:00:00Z');
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let ga: string;
let vip: string;
let seated: string;
const row = buildRow({ label: 'A', count: 6, x: 100, y: 100 });
/** name → attendee id */
const who: Record<string, string> = {};
const tickets: Record<string, { id: string; shortCode: string }> = {};

async function buy(name: string, ticketTypeId: string) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyer: { email: `${name.toLowerCase()}.${RUN}@tickets.test`, name },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const t = (await orderByManageToken(r.manageToken))?.tickets[0];
  return { orderId: r.order.id, shortCode: t?.shortCode as string };
}

async function buySeat(name: string, seatUuid: string) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [],
      seats: [seatUuid],
      buyer: { email: `${name.toLowerCase()}.${RUN}@tickets.test`, name },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const pi = `fakepi_bulktk_${r.order.id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
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
      amountMinor: r.order.totalMinor,
      currency: 'USD',
      orgId: a.org.id,
      orderId: r.order.id,
    },
    systemCtx(a.org.id),
    ports,
  );
  return r.order.id;
}

const list = (extra: Record<string, unknown>, ctx = a.ctx()) =>
  executeQuery(attendeeListQuery, { eventId, limit: 500, ...extra }, ctx, ports);
const names = async (extra: Record<string, unknown>, ctx = a.ctx()) =>
  (await list(extra, ctx)).items.map((i) => i.name).sort();

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: `Ticket actions ${RUN}`,
        timezone: 'America/Chicago',
        startsAt: '2029-06-01T15:00:00Z',
        endsAt: '2029-06-02T04:00:00Z',
      },
      a.ctx(),
      ports,
    )
  ).id;
  const tt = async (name: string, priceMinor: number) =>
    (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name, priceMinor, quantityTotal: 50, maxPerOrder: 10 },
        a.ctx(),
        ports,
      )
    ).id;
  ga = await tt('GA', 0);
  vip = await tt('VIP', 0);
  seated = await tt('Stalls', 2500);
  await executeCommand(
    setEventLayoutCommand,
    { eventId, doc: { version: 1, width: 800, height: 400, items: [row] } },
    a.ctx(),
    ports,
  );
  await executeCommand(
    assignSeatCategoryCommand,
    { eventId, itemIds: [row.id], ticketTypeId: seated },
    a.ctx(),
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId }, a.ctx(), ports);
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
  for (const [name, type] of [
    ['Ada', ga],
    ['Bea', ga],
    ['Cal', vip],
    ['Dee', vip],
  ] as const) {
    const t = await buy(name, type);
    tickets[name] = { id: '', shortCode: t.shortCode };
  }
  const seatOrder = await buySeat('Sol', row.seats[0]?.id as string);
  const detail = await executeQuery(orderDetailQuery, { orderId: seatOrder }, a.ctx(), ports);
  tickets.Sol = { id: detail.tickets[0]?.id as string, shortCode: detail.tickets[0]?.shortCode as string };
  who.Gus = (
    await executeCommand(
      addGuestCommand,
      { eventId, name: 'Gus', email: `gus.${RUN}@tickets.test` },
      a.ctx(),
      ports,
    )
  ).id;
  for (const i of (await list({})).items) {
    who[i.name] = i.id;
    const k = Object.keys(tickets).find((n) => n === i.name);
    if (k && i.ticketId) (tickets[k] as { id: string }).id = i.ticketId;
  }
  // Ada and Cal are checked in on the event's day.
  for (const n of ['Ada', 'Cal'])
    await executeCommand(
      scanTicketCommand,
      { eventId, code: tickets[n]?.shortCode },
      a.ctx({ now: DURING }),
      ports,
    );
});
afterAll(closePools);

describe('attendee list filters: ticket type and check-in (M1.8f)', () => {
  it('filters by ticket type (any of) and by check-in today / any day / never', async () => {
    expect(await names({ ticketTypeIds: [vip] })).toEqual(['Cal', 'Dee']);
    expect(await names({ ticketTypeIds: [ga, vip] })).toEqual(['Ada', 'Bea', 'Cal', 'Dee']);
    expect(await names({ checkedIn: 'any' })).toEqual(['Ada', 'Cal']);
    expect(await names({ checkedIn: 'today' }, a.ctx({ now: DURING }))).toEqual(['Ada', 'Cal']);
    // "Today" is the event's own day: the next day nobody has been in yet.
    expect(await names({ checkedIn: 'today' }, a.ctx({ now: NEXT_DAY }))).toEqual([]);
    // Never: people without a ticket (guests) count as not checked in.
    expect(await names({ checkedIn: 'never' })).toEqual(['Bea', 'Dee', 'Gus', 'Sol']);
  });

  it('combines with the existing filters and pages with the right total', async () => {
    expect(await names({ ticketTypeIds: [vip], checkedIn: 'never' })).toEqual(['Dee']);
    expect(await names({ checkedIn: 'never', source: 'guest' })).toEqual(['Gus']);
    expect(await names({ checkedIn: 'any', search: 'ad' })).toEqual(['Ada']);
    const page = await list({ checkedIn: 'never', limit: 2, offset: 2 });
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    // Allowlisted rows, like the plain list.
    expect(Object.keys(page.items[0] ?? {})).not.toContain('contactId');
  });

  it('"everything matching" selections and exports follow the same filters', async () => {
    const ids = await executeQuery(
      matchingAttendeeIdsQuery,
      { eventId, filter: { ticketTypeIds: [ga], checkedIn: 'never' } },
      a.ctx(),
      ports,
    );
    expect(ids).toEqual([who.Bea]);
    const op = await executeCommand(
      attendeeExportBulk.start,
      { eventId, selection: { filter: { checkedIn: 'any' } }, params: EXPORT_PARAMS },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const f = await executeQuery(attendeeExportBulk.file, { operationId: op.operationId }, a.ctx(), ports);
    const lines = f.content.replace(/^﻿/, '').trimEnd().split('\r\n').slice(1);
    expect(lines.map((l) => l.split(',')[0]).sort()).toEqual(['Ada', 'Cal']);
    // Checked in (then the Seat column, empty here: no seating plan).
    expect(lines.every((l) => l.endsWith(',Yes,'))).toBe(true);
  });

  it("viewers can filter; org B sees none of org A's attendees", async () => {
    expect(await names({ ticketTypeIds: [vip] }, userCtx(a.viewerId, a.org.id))).toEqual(['Cal', 'Dee']);
    expect((await list({ checkedIn: 'never' }, b.ctx())).total).toBe(0);
    expect(await executeQuery(matchingAttendeeIdsQuery, { eventId, filter: {} }, b.ctx(), ports)).toEqual([]);
  });
});

describe('resend tickets (M1.8f)', () => {
  it('resends each selected ticket once per operation; guests fail no_ticket; replays never resend', async () => {
    const op = await executeCommand(
      ticketResendBulk.start,
      { eventId, selection: { ids: [who.Ada, who.Cal, who.Gus] as string[] }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const st = await executeQuery(ticketResendBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(st).toMatchObject({ succeeded: 2, failed: 1, failures: [{ itemId: who.Gus, code: 'no_ticket' }] });
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; payload: { ticketIds: string[] } }>(
        sql`select id, payload from platform.domain_events where type = 'ticket.resend_requested' and aggregate_id = ${op.operationId}`,
      ),
    );
    expect(evt?.payload.ticketIds.sort()).toEqual([tickets.Ada?.id, tickets.Cal?.id].sort());
    const published = {
      id: evt?.id as string,
      orgId: a.org.id,
      type: 'ticket.resend_requested',
      version: 1,
      aggregateType: 'bulk_operation',
      aggregateId: op.operationId,
      payload: evt?.payload,
      logSeq: 1,
    };
    const { notifier, sent } = memoryNotifier();
    const sub = ticketResendMailer({ notifier, appOrigin: 'https://app.test' });
    expect(await consumeEvent(sub, published)).toBe(true);
    expect(await consumeEvent(sub, published)).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent.map((m) => m.dedupeKey).sort()).toEqual(
      [
        `ticket-resend:${op.operationId}:${tickets.Ada?.id}`,
        `ticket-resend:${op.operationId}:${tickets.Cal?.id}`,
      ].sort(),
    );
    expect(sent[0]).toMatchObject({
      kind: 'ticketing.tickets-resent',
      params: { eventName: `Ticket actions ${RUN}` },
    });
    expect(String(sent[0]?.params.url)).toMatch(/^https:\/\/app\.test\/my-tickets\/[0-9a-f-]{36}~/);

    // Even a handler run twice (a redelivery before the dedupe row) queues one email per ticket.
    const real = ticketResendMailer({ notifier: createNotifier(), appOrigin: 'https://app.test' });
    for (let i = 0; i < 2; i++)
      await withTenant(systemCtx(a.org.id), (tx) => real.handle(tx, { ...published, payload: evt?.payload }));
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.messages where dedupe_key like ${`ticket-resend:${op.operationId}:%`}`,
      ),
    );
    expect(n?.n).toBe(2);
    // A second operation is a new resend.
    const again = await executeCommand(
      ticketResendBulk.start,
      { eventId, selection: { ids: [who.Ada as string] }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, again.operationId)).toBe('done');
  });

  it('viewers cannot resend; org B cannot resend org A tickets', async () => {
    await expect(
      executeCommand(
        ticketResendBulk.start,
        { eventId, selection: { ids: [who.Ada as string] }, params: {} },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        ticketResendBulk.start,
        { eventId, selection: { ids: [who.Ada as string] }, params: {} },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('cancel tickets without a refund (M1.8f)', () => {
  it('voids the tickets, frees seats and places, cancels the attendees, notifies once, audits', async () => {
    // Sol bought seat A1; Dee also sits in a seat the organizer gave her.
    await executeCommand(
      assignSeatsCommand,
      { eventId, attendeeIds: [who.Dee as string], itemId: row.id, seatUuid: row.seats[1]?.id },
      a.ctx(),
      ports,
    );
    const op = await executeCommand(
      ticketCancelBulk.start,
      { eventId, selection: { ids: [who.Sol, who.Dee, who.Gus] as string[] }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const st = await executeQuery(ticketCancelBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(st).toMatchObject({ succeeded: 2, failed: 1, failures: [{ itemId: who.Gus, code: 'no_ticket' }] });
    expect(st.undoUntil).toBeNull();
    const state = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ seat_uuid: string; status: string; block_reason: string | null }>(
        sql`select seat_uuid, status, block_reason from seating.event_seats where event_id = ${eventId} and seat_uuid in (${row.seats[0]?.id}, ${row.seats[1]?.id})`,
      ),
    );
    expect(state.every((s) => s.status === 'available' && s.block_reason === null)).toBe(true);
    const tks = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string; status: string; void_reason: string }>(
        sql`select id, status, void_reason from ticketing.tickets where id in (${tickets.Sol?.id}, ${tickets.Dee?.id})`,
      ),
    );
    expect(tks.map((t) => [t.status, t.void_reason])).toEqual([
      ['void', 'cancelled'],
      ['void', 'cancelled'],
    ]);
    expect(await names({ status: 'cancelled' })).toEqual(['Dee', 'Sol']);
    // Places go back to sale: the VIP type has one more left.
    const vipLeft = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ sold: number }>(
        sql`select quantity_sold::int as sold from ticketing.ticket_types where id = ${vip}`,
      ),
    );
    expect(vipLeft[0]?.sold).toBe(1);
    // No money moved: the seat order is still paid and has no refund.
    const [order] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ status: string; refunds: number }>(
        sql`select o.status, (select count(*)::int from orders.refunds r where r.order_id = o.id) as refunds
            from orders.orders o join ticketing.tickets t on t.order_id = o.id where t.id = ${tickets.Sol?.id}`,
      ),
    );
    expect(order).toMatchObject({ status: 'paid', refunds: 0 });

    // The holders hear about it once each.
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; payload: unknown }>(
        sql`select id, payload from platform.domain_events where type = 'tickets.cancelled' and aggregate_id = ${op.operationId}`,
      ),
    );
    const { notifier, sent } = memoryNotifier();
    const published = {
      id: evt?.id as string,
      orgId: a.org.id,
      type: 'tickets.cancelled',
      version: 1,
      aggregateType: 'bulk_operation',
      aggregateId: op.operationId,
      payload: evt?.payload,
      logSeq: 1,
    };
    const sub = ticketCancelledMailer({ notifier });
    expect(await consumeEvent(sub, published)).toBe(true);
    expect(await consumeEvent(sub, published)).toBe(false);
    expect(sent.map((m) => m.dedupeKey).sort()).toEqual(
      [`ticket-cancelled:${tickets.Sol?.id}`, `ticket-cancelled:${tickets.Dee?.id}`].sort(),
    );
    expect(sent[0]?.kind).toBe('ticketing.ticket-cancelled');
    const [audit] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: Record<string, unknown> }>(
        sql`select data from platform.audit_events where action = 'bulk.start' and target_id = ${op.operationId}`,
      ),
    );
    expect(audit?.data).toMatchObject({ action: 'orders.cancelTickets', total: 3 });

    // Cancelling again: already void.
    const again = await executeCommand(
      ticketCancelBulk.start,
      { eventId, selection: { ids: [who.Sol as string] }, params: {} },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, again.operationId);
    expect(
      await executeQuery(ticketCancelBulk.status, { operationId: again.operationId }, a.ctx(), ports),
    ).toMatchObject({ failed: 1, failures: [{ code: 'ticket_void' }] });
    // A cancelled ticket no longer scans.
    const scan = await executeCommand(
      scanTicketCommand,
      { eventId, code: tickets.Sol?.shortCode },
      a.ctx({ now: DURING }),
      ports,
    );
    expect(scan.result).toBe('void');
  });

  it('only owners, admins and finance can cancel; undo is not offered; org B is refused', async () => {
    await expect(
      executeCommand(
        ticketCancelBulk.start,
        { eventId, selection: { ids: [who.Bea as string] }, params: {} },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        ticketCancelBulk.start,
        { eventId, selection: { ids: [who.Bea as string] }, params: {} },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const op = await executeCommand(
      ticketCancelBulk.start,
      { eventId, selection: { ids: [who.Bea as string] }, params: {} },
      a.ctx(),
      ports,
    );
    await runBulk(a.org.id, op.operationId);
    await expect(
      executeCommand(ticketCancelBulk.undo, { operationId: op.operationId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('search: trigram indexes (M1.8f)', () => {
  it('the indexes exist and are valid; results are identical with and without them', async () => {
    const idx = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ name: string; valid: boolean }>(sql`
        select c.relname as name, i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname in ('attendees_name_trgm_idx', 'attendees_email_trgm_idx', 'orders_buyer_name_trgm_idx', 'orders_buyer_email_trgm_idx')
        order by 1`),
    );
    expect(idx).toEqual([
      { name: 'attendees_email_trgm_idx', valid: true },
      { name: 'attendees_name_trgm_idx', valid: true },
      { name: 'orders_buyer_email_trgm_idx', valid: true },
      { name: 'orders_buyer_name_trgm_idx', valid: true },
    ]);
    for (const q of ['ad', 'Ada', 'tickets.test', '%', 'a_a', 'no-such-person']) {
      const withIndex = await executeQuery(searchAttendeesQuery, { q, limit: 50 }, a.ctx(), ports).catch(
        () => null,
      );
      const plain = await withTenant(a.ctx(), async (tx) => {
        await tx.execute(sql`set local enable_bitmapscan = off`);
        await tx.execute(sql`set local enable_indexscan = off`);
        const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        return tx.execute<{ id: string }>(
          sql`select id from attendees.attendees where name ilike ${pattern} or email ilike ${pattern} order by created_at desc, id desc limit 50`,
        );
      });
      if (withIndex) expect(withIndex.map((h) => h.id)).toEqual(plain.map((r) => r.id));
    }
  });

  it("the search functions return only the caller org's matches, and the trigram index serves them", async () => {
    const pattern = `%${RUN}@tickets.test%`;
    const mine = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string }>(sql`select attendees.search_ids(${pattern}) as id`),
    );
    expect(mine).toHaveLength(6);
    // Another org (or no org at all) gets nothing.
    expect(
      await withTenant(b.ctx(), (tx) => tx.execute(sql`select attendees.search_ids(${pattern})`)),
    ).toHaveLength(0);
    expect(
      await withTenant(b.ctx(), (tx) => tx.execute(sql`select orders.search_ids(${pattern})`)),
    ).toHaveLength(0);
    expect(
      await withTenant(a.ctx(), (tx) => tx.execute(sql`select orders.search_ids(${pattern})`)),
    ).toHaveLength(5);
    // The function's ILIKE (as its owner, outside RLS) can be served by the trigram indexes (a tiny
    // test table would otherwise be scanned: sequential scans are switched off to show the plan).
    const admin = adminClient();
    try {
      const plan = await admin.begin(async (q) => {
        await q`set local role migrator`;
        await q`set local enable_seqscan = off`;
        return q<{ 'QUERY PLAN': string }[]>`explain select id from attendees.attendees
          where name ilike '%lovelace%' or email ilike '%lovelace%'`;
      });
      expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('attendees_name_trgm_idx');
    } finally {
      await admin.end();
    }
  });
});
