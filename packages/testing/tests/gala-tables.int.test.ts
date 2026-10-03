import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  hostedTablesQuery,
  hostNameTableSlotCommand,
  nameTableSlotCommand,
  publicTableQuery,
  resendTableLinkCommand,
  sendTableRemindersCommand,
  setTableCompanyCommand,
  startCheckoutCommand,
  startRefundCommand,
  tableLinkContext,
  tableNamingMailer,
  tableNamingPath,
} from '@yayatoh/orders';
import { memoryNotifier, type PublishedEvent } from '@yayatoh/platform';
import {
  assignSeatsCommand,
  findSeatByNameCommand,
  planTablesQuery,
  publicVenueMapQuery,
  publishEventLayoutCommand,
  removeTableSponsorCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
  setTableSponsorCommand,
} from '@yayatoh/seating';
import { createTicketTypeCommand, listTicketTypesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.2b gala tables and sponsors: a table ticket ("Table of 10") issues the table and its ten
 * guest slots (tickets) with the order; the buyer names them through the table's claim link,
 * the host by hand. Concurrent naming never exceeds the table; a refund takes the unnamed slots
 * with it. Hosted tables carry sponsors, shown to guests only once published.
 */

let a: OrgFixture;
let b: OrgFixture;
let gala: { id: string; endsAt: Date };
let tableType: string;
let payType: string;
const publicCtx = (f: OrgFixture = a, extra: Partial<Ctx> = {}) => createCtx({ orgId: f.org.id, ...extra });
const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, f: OrgFixture = a) =>
  withTenant(systemCtx(f.org.id), (tx) => tx.execute<T>(query));

async function newGala(f: OrgFixture, name: string) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'gala',
      timezone: 'America/Chicago',
      startsAt: '2027-11-20T00:00:00Z',
      endsAt: '2027-11-20T05:00:00Z',
    },
    f.ctx(),
    ports,
  );
  return { id: e.id, endsAt: e.endsAt };
}

async function tableTicket(f: OrgFixture, eventId: string, size: number, priceMinor = 0) {
  return (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name: `Table of ${size}`, priceMinor, quantityTotal: 20, tableSize: size },
      f.ctx(),
      ports,
    )
  ).id;
}

/** Buy tables (free ones are paid at once; priced ones through the fake provider). */
async function buyTables(typeId: string, quantity: number, f: OrgFixture = a, eventId = gala.id) {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: typeId, quantity }],
      buyer: { email: 'chair@example.test', name: 'Gala Chair' },
    },
    publicCtx(f),
    ports,
  );
  if (c.order.status !== 'paid') {
    const pi = `fakepi_tables_${c.order.id}`;
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: 'fake', providerPaymentId: pi },
      publicCtx(f),
      ports,
    );
    await executeCommand(
      applyProviderEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_tables_${c.order.id}`,
        type: 'payment.succeeded',
        providerPaymentId: pi,
        amountMinor: c.order.totalMinor,
        currency: 'USD',
        orgId: f.org.id,
        orderId: c.order.id,
      },
      systemCtx(f.org.id),
      ports,
    );
  }
  const units = await q<{ id: string }>(
    sql`select id from ticketing.table_units where order_id = ${c.order.id} order by unit_no`,
    f,
  );
  return { orderId: c.order.id, totalMinor: c.order.totalMinor, tableIds: units.map((u) => u.id) };
}

const slotsOf = async (tableUnitId: string, f: OrgFixture = a) =>
  q<{ id: string; status: string; holder_name: string; rev: number; attendee_id: string }>(
    sql`select id, status, holder_name, rev, attendee_id from ticketing.tickets where table_unit_id = ${tableUnitId} order by serial`,
    f,
  );

const name = (tableUnitId: string, firstName: string, extra: Record<string, unknown> = {}) =>
  executeCommand(nameTableSlotCommand, { tableUnitId, firstName, ...extra }, publicCtx(), ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  gala = await newGala(a, 'Gala Tables Night');
  tableType = await tableTicket(a, gala.id, 10);
  payType = await tableTicket(a, gala.id, 4, 100_000);
  await executeCommand(transitionEventCommand, { eventId: gala.id, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

describe('table tickets', () => {
  it('a table ticket has a size between 2 and 20 and a fixed price', async () => {
    const types = await executeQuery(listTicketTypesQuery, { eventId: gala.id }, a.ctx(), ports);
    expect(types.find((t) => t.id === tableType)?.tableSize).toBe(10);
    for (const bad of [{ tableSize: 1 }, { tableSize: 21 }, { tableSize: 8, isDonation: true }])
      await expect(
        executeCommand(
          createTicketTypeCommand,
          { eventId: gala.id, name: 'Bad table', priceMinor: 100, quantityTotal: 5, ...bad },
          a.ctx(),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('buying a table of 10 gives exactly 10 guest slots, and the table counts once', async () => {
    const { tableIds } = await buyTables(tableType, 2);
    expect(tableIds).toHaveLength(2);
    for (const id of tableIds) {
      const slots = await slotsOf(id);
      expect(slots).toHaveLength(10);
      expect(new Set(slots.map((s) => s.holder_name))).toEqual(new Set(['Gala Chair']));
    }
    const types = await executeQuery(listTicketTypesQuery, { eventId: gala.id }, a.ctx(), ports);
    expect(types.find((t) => t.id === tableType)?.quantitySold).toBe(2);
    const listed = await executeQuery(hostedTablesQuery, { eventId: gala.id }, a.ctx(), ports);
    const first = listed.find((t) => t.id === tableIds[0]);
    expect(first).toMatchObject({ size: 10, named: 0, missing: 10, company: null, buyerName: 'Gala Chair' });
    expect(first?.slots).toHaveLength(10);
  });
});

describe('naming through the claim link', () => {
  it('the link resolves to its table and org; a forged one to nothing', async () => {
    const { tableIds } = await buyTables(tableType, 1);
    const id = tableIds[0] as string;
    const token = tableNamingPath(id).split('/').pop() as string;
    const resolved = await tableLinkContext(token);
    expect(resolved?.id).toBe(id);
    expect(resolved?.ctx.orgId).toBe(a.org.id);
    expect(await tableLinkContext(`${id}~forged`)).toBeNull();
    expect(await tableLinkContext('not-a-token')).toBeNull();
  });

  it('naming a slot reissues its ticket to the guest and makes them a guest of the table party', async () => {
    const { tableIds } = await buyTables(tableType, 1);
    const id = tableIds[0] as string;
    await executeCommand(
      setTableCompanyCommand,
      { tableUnitId: id, company: 'Acme Corp' },
      publicCtx(),
      ports,
    );
    const r = await name(id, 'Ada', { lastName: 'Lovelace', email: 'ada@example.test' });
    expect(r).toMatchObject({ named: 1, missing: 9, rev: 1 });
    const [slot] = (await slotsOf(id)).filter((s) => s.id === r.ticketId);
    expect(slot).toMatchObject({ holder_name: 'Ada Lovelace', rev: 1, status: 'active' });
    const [guest] = await q<{
      party: string;
      ticket_id: string;
      attendee_id: string;
      first_name: string;
      source: string;
    }>(sql`
      select p.name as party, g.ticket_id, g.attendee_id, g.first_name, p.source
      from guests.guests g join guests.parties p on p.id = g.party_id where g.id = ${r.guestId}`);
    expect(guest).toMatchObject({
      party: 'Acme Corp',
      ticket_id: r.ticketId,
      first_name: 'Ada',
      source: 'table_link',
    });
    // The guest is linked to the ticket's attendee, who now carries the guest's name.
    expect(guest?.attendee_id).toBe(slot?.attendee_id);
    const [att] = await q<{ name: string }>(
      sql`select name from attendees.attendees where id = ${slot?.attendee_id}`,
    );
    expect(att?.name).toBe('Ada Lovelace');
    // History records the source and field names only.
    const [h] = await q<{ fields: string[]; source: string }>(
      sql`select fields, source from guests.rsvp_history where guest_id = ${r.guestId}`,
    );
    expect(h).toMatchObject({ source: 'table_link' });
    expect(h?.fields).toEqual(expect.arrayContaining(['firstName', 'ticketId']));
    const table = await executeQuery(publicTableQuery, { tableUnitId: id }, publicCtx(), ports);
    expect(table).toMatchObject({ company: 'Acme Corp', named: 1, missing: 9, closed: null });
    expect(JSON.stringify(table)).not.toContain('ada@example.test');
    expect(JSON.stringify(table)).not.toContain('chair@example.test');
  });

  it('without a company the party takes the buyer’s name; a slot is named once', async () => {
    const { tableIds } = await buyTables(tableType, 1);
    const id = tableIds[0] as string;
    const r = await name(id, 'Bo');
    const [p] = await q<{ name: string }>(sql`select name from guests.parties where table_unit_id = ${id}`);
    expect(p?.name).toBe('Gala Chair');
    await expect(name(id, 'Cy', { ticketId: r.ticketId })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'slot_named' },
    });
  });

  it('the claim link names only its own table’s slots', async () => {
    const one = (await buyTables(tableType, 1)).tableIds[0] as string;
    const other = (await buyTables(tableType, 1)).tableIds[0] as string;
    const [foreign] = await slotsOf(other);
    await expect(name(one, 'Intruder', { ticketId: foreign?.id })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await executeQuery(publicTableQuery, { tableUnitId: other }, publicCtx(), ports)).named).toBe(0);
  });

  it('concurrent claims never exceed the table: 15 people race for 10 seats', async () => {
    const id = (await buyTables(tableType, 1)).tableIds[0] as string;
    const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => name(id, `Racer${i}`)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(10);
    for (const r of results)
      if (r.status === 'rejected')
        expect(r.reason).toMatchObject({ code: 'invalid_state', details: { reason: 'table_full' } });
    const [n] = await q<{ n: number; tickets: number }>(sql`
      select count(*)::int as n, count(distinct g.ticket_id)::int as tickets from guests.guests g
      join guests.parties p on p.id = g.party_id where p.table_unit_id = ${id}`);
    expect(n).toEqual({ n: 10, tickets: 10 });
  });

  it('naming closes when the event is over', async () => {
    const id = (await buyTables(tableType, 1)).tableIds[0] as string;
    const later = new Date(gala.endsAt.getTime() + 60_000);
    await expect(
      executeCommand(
        nameTableSlotCommand,
        { tableUnitId: id, firstName: 'Late' },
        publicCtx(a, { now: later }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'event_over' } });
    const t = await executeQuery(publicTableQuery, { tableUnitId: id }, publicCtx(a, { now: later }), ports);
    expect(t.closed).toBe('event_over');
  });
});

describe('the host', () => {
  it('names a slot by hand, sees the ticket’s guest, and a viewer may only look', async () => {
    const id = (await buyTables(tableType, 1)).tableIds[0] as string;
    const r = await executeCommand(
      hostNameTableSlotCommand,
      { eventId: gala.id, tableUnitId: id, firstName: 'Hosted', lastName: 'Guest' },
      a.ctx(),
      ports,
    );
    const listed = (await executeQuery(hostedTablesQuery, { eventId: gala.id }, a.ctx(), ports)).find(
      (t) => t.id === id,
    );
    expect(listed?.slots.find((s) => s.ticketId === r.ticketId)?.guestName).toBe('Hosted Guest');
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(
      (await executeQuery(hostedTablesQuery, { eventId: gala.id }, viewer, ports)).length,
    ).toBeGreaterThan(0);
    await expect(
      executeCommand(
        hostNameTableSlotCommand,
        { eventId: gala.id, tableUnitId: id, firstName: 'No' },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(sendTableRemindersCommand, { eventId: gala.id }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a table of another event is not found, even in the same org', async () => {
    const id = (await buyTables(tableType, 1)).tableIds[0] as string;
    const other = await newGala(a, 'Other Gala');
    await expect(
      executeCommand(
        hostNameTableSlotCommand,
        { eventId: other.id, tableUnitId: id, firstName: 'X' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reminds buyers of tables missing names, at most once an hour per table', async () => {
    const ev = await newGala(a, 'Reminder Gala');
    const t = await tableTicket(a, ev.id, 2);
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const [full] = (await buyTables(t, 1, a, ev.id)).tableIds;
    const [open] = (await buyTables(t, 1, a, ev.id)).tableIds;
    await name(full as string, 'One');
    await name(full as string, 'Two');
    const first = await executeCommand(sendTableRemindersCommand, { eventId: ev.id }, a.ctx(), ports);
    expect(first).toEqual({ sent: 1, skipped: 1 });
    const again = await executeCommand(sendTableRemindersCommand, { eventId: ev.id }, a.ctx(), ports);
    expect(again).toEqual({ sent: 0, skipped: 2 });
    const later = a.ctx({ now: new Date(Date.now() + 61 * 60_000) });
    expect(
      await executeCommand(
        sendTableRemindersCommand,
        { eventId: ev.id, tableUnitIds: [open as string] },
        later,
        ports,
      ),
    ).toEqual({ sent: 1, skipped: 0 });
  });
});

describe('emails', () => {
  it('the buyer gets the claim link when the order is paid, again on request (once a minute), and reminders', async () => {
    const ev = await newGala(a, 'Mail Gala');
    const t = await tableTicket(a, ev.id, 3);
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    const { orderId, tableIds } = await buyTables(t, 1, a, ev.id);
    const id = tableIds[0] as string;
    const { notifier, sent } = memoryNotifier();
    const mailer = tableNamingMailer({ notifier, appOrigin: 'http://localhost' });
    const run = async (type: string, payload: Record<string, unknown>) =>
      withTenant(systemCtx(a.org.id), (tx) =>
        mailer.handle(tx, {
          id: crypto.randomUUID(),
          orgId: a.org.id,
          type,
          version: 1,
          aggregateType: 'test',
          aggregateId: crypto.randomUUID(),
          payload,
          logSeq: 0,
        } satisfies PublishedEvent),
      );
    await run('order.paid', { orgId: a.org.id, orderId });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'orders.table-naming',
      to: { email: 'chair@example.test' },
      params: { size: 3, missing: 3, reminder: 0, url: `http://localhost${tableNamingPath(id)}` },
    });
    // The first email was just counted: a resend waits a minute.
    expect(await executeCommand(resendTableLinkCommand, { tableUnitId: id }, publicCtx(), ports)).toEqual({
      sent: false,
    });
    const soon = publicCtx(a, { now: new Date(Date.now() + 61_000) });
    expect(await executeCommand(resendTableLinkCommand, { tableUnitId: id }, soon, ports)).toEqual({
      sent: true,
    });
    await run('table.naming_link_requested', {
      orgId: a.org.id,
      eventId: ev.id,
      tableUnitId: id,
      kind: 'resend',
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]?.dedupeKey).not.toBe(sent[0]?.dedupeKey);
    await run('table.naming_link_requested', {
      orgId: a.org.id,
      eventId: ev.id,
      tableUnitId: id,
      kind: 'reminder',
    });
    expect(sent[2]?.params).toMatchObject({ reminder: 1 });
    // A paid order without tables sends nothing.
    sent.length = 0;
    await run('order.paid', { orgId: a.org.id, orderId: crypto.randomUUID() });
    expect(sent).toHaveLength(0);
  });
});

describe('refunds', () => {
  it('refunds a table whole (once, at the table price) and takes its unnamed slots with it', async () => {
    const { orderId, totalMinor, tableIds } = await buyTables(payType, 1);
    const id = tableIds[0] as string;
    const named = await name(id, 'Keeper');
    const slots = await slotsOf(id);
    await expect(
      executeCommand(
        startRefundCommand,
        { orderId, reason: 'requested_by_customer', ticketIds: [slots[0]?.id] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'table_partial' } });
    const r = await executeCommand(
      startRefundCommand,
      { orderId, reason: 'event_cancelled', ticketIds: slots.map((s) => s.id) },
      a.ctx(),
      ports,
    );
    expect(r.amountMinor).toBe(totalMinor);
    await executeCommand(
      completeRefundCommand,
      { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
      a.ctx(),
      ports,
    );
    const table = (await executeQuery(hostedTablesQuery, { eventId: gala.id }, a.ctx(), ports)).find(
      (t) => t.id === id,
    );
    expect(table?.slots).toHaveLength(0);
    expect(table).toMatchObject({ named: 0, missing: 0 });
    // The named guest stays on the list (their ticket is void); the table is back on sale.
    const [g] = await q<{ id: string }>(sql`select id from guests.guests where id = ${named.guestId}`);
    expect(g?.id).toBe(named.guestId);
    const types = await executeQuery(listTicketTypesQuery, { eventId: gala.id }, a.ctx(), ports);
    expect(types.find((t) => t.id === payType)?.quantitySold).toBe(0);
    await expect(name(id, 'Too late')).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('hosted table sponsors', () => {
  it('a plan table carries a sponsor; guests see it only once published on a plan on sale', async () => {
    const ev = await newGala(a, 'Sponsor Gala');
    const doc = quickLayout({ rows: 0, seatsPerRow: 0, tables: 2, seatsPerTable: 4, stage: false });
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, a.ctx(), ports);
    const [t1, t2] = await executeQuery(planTablesQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(t1).toMatchObject({ seats: 4, sponsor: null });
    await expect(
      executeCommand(
        setTableSponsorCommand,
        { eventId: ev.id, itemId: crypto.randomUUID(), sponsorName: 'Nobody' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'not_a_table' } });
    await expect(
      executeCommand(
        setTableSponsorCommand,
        {
          eventId: ev.id,
          itemId: t1?.itemId,
          sponsorName: 'Acme',
          logoUrl: `/media/${b.org.id}/${crypto.randomUUID()}/logo.webp`,
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'foreign_logo' } });
    await executeCommand(
      setTableSponsorCommand,
      { eventId: ev.id, itemId: t1?.itemId, sponsorName: 'Acme Corp', published: true },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setTableSponsorCommand,
      { eventId: ev.id, itemId: t2?.itemId, sponsorName: 'Secret Sponsor', published: false },
      a.ctx(),
      ports,
    );
    const tables = await executeQuery(planTablesQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(tables.map((t) => t.sponsor?.sponsorName)).toEqual(['Acme Corp', 'Secret Sponsor']);
    await executeCommand(
      setFinderSettingsCommand,
      { eventId: ev.id, publicMap: true, mode: 'name' },
      a.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
    // A draft plan: no sponsor is public yet.
    const draft = await executeQuery(publicVenueMapQuery, { eventId: ev.id }, publicCtx(), ports);
    expect(draft?.sponsors).toEqual([]);
    await executeCommand(publishEventLayoutCommand, { eventId: ev.id }, a.ctx(), ports);
    const map = await executeQuery(publicVenueMapQuery, { eventId: ev.id }, publicCtx(), ports);
    expect(map?.sponsors).toEqual([{ itemId: t1?.itemId, sponsorName: 'Acme Corp', logoUrl: null }]);
    // The seat finder: a guest at each table sees the published sponsor, never the unpublished one.
    const t = await tableTicket(a, ev.id, 2);
    const { tableIds } = await buyTables(t, 1, a, ev.id);
    const slots = await slotsOf(tableIds[0] as string);
    await name(tableIds[0] as string, 'Finder', { lastName: 'One' });
    await name(tableIds[0] as string, 'Finder', { lastName: 'Two' });
    const seat = async (attendeeId: string | undefined, itemId: string | undefined) =>
      executeCommand(
        assignSeatsCommand,
        { eventId: ev.id, attendeeIds: [attendeeId as string], itemId: itemId as string },
        a.ctx(),
        ports,
      );
    await seat(slots[0]?.attendee_id, t1?.itemId);
    await seat(slots[1]?.attendee_id, t2?.itemId);
    const look = async (who: string) =>
      (
        await executeCommand(
          findSeatByNameCommand,
          { eventId: ev.id, name: who, device: `device-${who}-0123456789` },
          publicCtx(),
          ports,
        )
      ).result?.seats[0];
    expect(await look('Finder One')).toMatchObject({ sponsor: 'Acme Corp' });
    expect(await look('Finder Two')).toMatchObject({ sponsor: null });
    await executeCommand(removeTableSponsorCommand, { eventId: ev.id, itemId: t1?.itemId }, a.ctx(), ports);
    expect(await look('Finder One')).toMatchObject({ sponsor: null });
  });

  it('a viewer cannot set sponsors', async () => {
    await expect(
      executeCommand(
        setTableSponsorCommand,
        { eventId: gala.id, itemId: crypto.randomUUID(), sponsorName: 'X' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('tenant isolation', () => {
  it('another org never sees or names a table, by id or by its link', async () => {
    const id = (await buyTables(tableType, 1)).tableIds[0] as string;
    await expect(
      executeCommand(nameTableSlotCommand, { tableUnitId: id, firstName: 'Mallory' }, publicCtx(b), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(publicTableQuery, { tableUnitId: id }, publicCtx(b), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(
        hostNameTableSlotCommand,
        { eventId: gala.id, tableUnitId: id, firstName: 'M' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(hostedTablesQuery, { eventId: gala.id }, b.ctx(), ports)).toEqual([]);
    const [n] = await q<{ n: number }>(
      sql`select count(*)::int as n from ticketing.table_units where id = ${id}`,
      b,
    );
    expect(n?.n).toBe(0);
  });
});
