import { listAttendeesQuery } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { getEventQuery } from '@yayatoh/events';
import {
  connectionDetailQuery,
  disconnectCommand,
  dismissErrorsCommand,
  EB_ORDERS_PAGE,
  EVENTBRITE_FIXTURE_COUNTS,
  eventbritePreview,
  eventbriteRemoteRefund,
  eventbriteRemoteRename,
  eventbriteRequests,
  fakeIntegrations,
  importResultQuery,
  linkEventSheet,
  linkSheetCommand,
  listErrorGroupsQuery,
  requestSyncCommand,
  retryErrorsCommand,
  runSync,
  setSyncIntervalCommand,
  sheetLinksQuery,
  sheetsRemoteAdd,
  sheetsRemoteDelete,
  sheetsRemoteEdit,
  sheetsRemoteList,
  sheetsRemoteRows,
  unlinkSheetCommand,
} from '@yayatoh/integrations';
import { type Ctx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { addGuestCommand, setAttendeeLabelsCommand } from '@yayatoh/attendees';
import { createEventCommand } from '@yayatoh/events';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findCanaries } from '../src/canary/index.ts';
import { bareOrg, connectConnector, fakeAuth, type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.4b on real Postgres against the recorded fakes: the Eventbrite importer (dry-run preview,
 * import reproducing the fixture account's counts and revenue to the cent, re-runs that write
 * nothing, a refund at Eventbrite, a reconnect that never duplicates, imported orders that never
 * pay or email) and Google Sheets live sync (link, round trips without duplicates, sheet edits and
 * new rows, a deleted row that only flags, last-writer conflicts with the losing value in the
 * inbox, unlink), with permissions and tenant isolation.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
const deps = { auth: fakeAuth };
const tag = uuidv7().slice(-8);
let n = 0;
const fresh = () => bareOrg(`m64b-${tag}-${++n}`, `M6.4b ${n}`);

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
}, 300_000);
afterAll(async () => {
  await closePools();
  await admin.end();
});

const thrown: unknown[] = [];
const expectError = async (p: Promise<unknown>, code: string, reason?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  thrown.push(err);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (reason) expect((err as DomainError).details?.reason).toBe(reason);
};
const account = (authConnectionId: string) => {
  const acc = fakeIntegrations.account(authConnectionId);
  if (!acc) throw new Error('no fake account');
  return acc;
};
const run = (orgId: string, connectionId: string) => runSync(orgId, connectionId, deps, ports, { force: true });
const q = <T>(ctx: Ctx, query: ReturnType<typeof sql>) =>
  withTenant(ctx, async (tx) => (await tx.execute(query)) as unknown as T[]);
const groups = (ctx: Ctx, status: 'open' | 'resolved' | 'dismissed' = 'open') =>
  executeQuery(listErrorGroupsQuery, { status }, ctx, ports);

async function connectEventbrite(ctx: Ctx) {
  return connectConnector(ctx, 'eventbrite');
}

/** Import the whole fixture account into a fresh org (what the wizard's Import does). */
async function importedOrg() {
  const o = await fresh();
  const eb = await connectEventbrite(o.ctx());
  await executeCommand(requestSyncCommand, { connectionId: eb.connectionId }, o.ctx(), ports);
  const r = await runSync(o.orgId, eb.connectionId, deps, ports);
  return { ...o, eb, result: r };
}

describe('Eventbrite importer', () => {
  it('connecting queues nothing and schedules nothing: an import waits to be started', async () => {
    const o = await fresh();
    const eb = await connectEventbrite(o.ctx());
    const detail = await executeQuery(connectionDetailQuery, { connectionId: eb.connectionId }, o.ctx(), ports);
    expect(detail.connection).toMatchObject({ status: 'active', nextSyncAt: null, accountLabel: expect.stringContaining('Eventbrite') });
    expect(detail.runs).toEqual([]);
    expect(detail.mappings.map((m) => `${m.objectType}:${m.direction}`).sort()).toEqual([
      'events:pull',
      'orders:pull',
      'ticket_classes:pull',
    ]);
    // Nothing to run until someone starts it; the interval does not apply.
    expect((await runSync(o.orgId, eb.connectionId, deps, ports)).status).toBe('idle');
    await expectError(
      executeCommand(setSyncIntervalCommand, { connectionId: eb.connectionId, minutes: 60 }, o.ctx(), ports),
      'invalid_state',
      'importer',
    );
  });

  it('the dry-run preview counts the account and writes nothing', async () => {
    const o = await fresh();
    const eb = await connectEventbrite(o.ctx());
    const p = await eventbritePreview(o.ctx(), deps, ports, eb.connectionId);
    expect(p).toEqual({
      events: { total: 3, new: 3 },
      ticketTypes: { total: 6, new: 6 },
      orders: { total: 9, new: 9 },
      refundedOrders: 1,
      attendees: EVENTBRITE_FIXTURE_COUNTS.attendees,
      revenue: EVENTBRITE_FIXTURE_COUNTS.revenue,
    });
    // Read page by page as Eventbrite paginates (3 orders pages of 4).
    expect(eventbriteRequests(account(eb.authConnectionId))).toBeGreaterThanOrEqual(
      1 + 2 * 2 + Math.ceil(9 / EB_ORDERS_PAGE),
    );
    const [counts] = await q<{ events: number; orders: number }>(
      o.ctx(),
      sql`select (select count(*)::int from events.events) as events, (select count(*)::int from orders.orders) as orders`,
    );
    expect(counts).toEqual({ events: 0, orders: 0 });
    const detail = await executeQuery(connectionDetailQuery, { connectionId: eb.connectionId }, o.ctx(), ports);
    expect(detail.runs).toEqual([]);
  });

  it('an import into a fresh org reproduces the fixture account (counts, revenue to the cent)', async () => {
    const o = await importedOrg();
    expect(o.result).toMatchObject({ status: 'claimed', runStatus: 'succeeded' });
    const r = await executeQuery(importResultQuery, { connectionId: o.eb.connectionId }, o.ctx(), ports);
    expect(r.run).toMatchObject({ status: 'succeeded', failed: 0, pulled: 3 + 6 + 9 });
    expect(r.imported).toEqual({
      events: EVENTBRITE_FIXTURE_COUNTS.events,
      ticketTypes: EVENTBRITE_FIXTURE_COUNTS.ticketTypes,
      orders: EVENTBRITE_FIXTURE_COUNTS.orders,
      paidOrders: EVENTBRITE_FIXTURE_COUNTS.paidOrders,
      attendees: EVENTBRITE_FIXTURE_COUNTS.attendees,
      activeAttendees: EVENTBRITE_FIXTURE_COUNTS.activeAttendees,
      revenue: EVENTBRITE_FIXTURE_COUNTS.revenue,
    });
    // The same numbers straight from the tables.
    const [t] = await q<{ events: number; types: number; orders: number; attendees: number; usd: string; eur: string }>(
      o.ctx(),
      sql`select (select count(*)::int from events.events) as events,
                 (select count(*)::int from ticketing.ticket_types) as types,
                 (select count(*)::int from orders.orders where created_via = 'import') as orders,
                 (select count(*)::int from attendees.attendees) as attendees,
                 (select coalesce(sum(total_minor), 0)::text from orders.orders where status = 'paid' and currency = 'USD') as usd,
                 (select coalesce(sum(total_minor), 0)::text from orders.orders where status = 'paid' and currency = 'EUR') as eur`,
    );
    expect(t).toEqual({ events: 3, types: 6, orders: 9, attendees: 15, usd: '55259', eur: '8980' });
    // Times are instants with the event's IANA zone; money in minor units.
    const [jazz] = await q<{ id: string; timezone: string; starts_at: Date; status: string; currency: string }>(
      o.ctx(),
      sql`select id, timezone, starts_at, status, currency from events.events where name = 'Summer Jazz Night'`,
    );
    expect(jazz).toMatchObject({ timezone: 'America/Chicago', status: 'draft', currency: 'USD' });
    expect(new Date(String(jazz?.starts_at)).toISOString()).toBe('2026-07-18T23:00:00.000Z');
    const types = await q<{ name: string; price_minor: string; visibility: string; quantity_sold: number }>(
      o.ctx(),
      sql`select name, price_minor::text, visibility, quantity_sold from ticketing.ticket_types order by name`,
    );
    expect(types).toContainEqual({ name: 'VIP lounge', price_minor: '6000', visibility: 'public', quantity_sold: 1 });
    expect(types).toContainEqual({ name: 'Supporter', price_minor: '4000', visibility: 'hidden', quantity_sold: 1 });
    // The refunded order took no place.
    expect(types).toContainEqual({ name: 'General admission', price_minor: '2500', visibility: 'public', quantity_sold: 3 });
    // Each attendee is named as on Eventbrite (not the buyer).
    const holders = await q<{ name: string; email: string; status: string }>(
      o.ctx(),
      sql`select holder_name as name, holder_email as email, status from ticketing.tickets order by holder_name`,
    );
    expect(holders).toContainEqual({ name: 'Charles Babbage', email: 'charles@eb-buyers.test', status: 'active' });
    expect(holders).toContainEqual({ name: 'Edsger Dijkstra', email: 'edsger@eb-buyers.test', status: 'void' });
  });

  it('imported orders are marked imported and never pay or email', async () => {
    const o = await importedOrg();
    const orders = await q<{
      id: string;
      created_via: string;
      collected_by: string;
      provider: string;
      provider_payment_id: string;
      status: string;
      total_minor: string;
      subtotal_minor: string;
    }>(
      o.ctx(),
      sql`select id, created_via, collected_by, provider, provider_payment_id, status, total_minor::text, subtotal_minor::text from orders.orders order by provider_payment_id`,
    );
    expect(orders).toHaveLength(9);
    for (const x of orders) expect(x).toMatchObject({ created_via: 'import', collected_by: 'organizer', provider: 'eventbrite' });
    expect(orders[0]).toMatchObject({ provider_payment_id: '5550001', status: 'paid', subtotal_minor: '5000', total_minor: '5674' });
    expect(orders[3]).toMatchObject({ provider_payment_id: '5550004', status: 'refunded' });
    const ids = orders.map((x) => x.id);
    const events = await admin<{ type: string; n: number }[]>`
      select type, count(*)::int as n from platform.domain_events
      where org_id = ${o.orgId} and aggregate_id = any(${ids}::text[]) group by type order by type`;
    // No `order.paid` (the tickets email, receipts, journeys and the payment ledger follow it).
    expect(events).toEqual([{ type: 'order.imported', n: 9 }]);
    const [ledger] = await admin<{ n: number }[]>`
      select count(*)::int as n from payments.ledger_entries where org_id = ${o.orgId}`.catch(() => [{ n: 0 }]);
    expect(ledger?.n ?? 0).toBe(0);
    const [mail] = await admin<{ n: number }[]>`
      select count(*)::int as n from notifications.messages where org_id = ${o.orgId}`;
    expect(mail?.n).toBe(0);
  });

  it('a re-run writes nothing; the preview then says nothing is new', async () => {
    const o = await importedOrg();
    await executeCommand(requestSyncCommand, { connectionId: o.eb.connectionId }, o.ctx(), ports);
    const again = await runSync(o.orgId, o.eb.connectionId, deps, ports);
    expect(again.runStatus).toBe('succeeded');
    const r = await executeQuery(importResultQuery, { connectionId: o.eb.connectionId }, o.ctx(), ports);
    // Events and ticket classes are read again (and skipped); orders only when changed.
    expect(r.run).toMatchObject({ pulled: 0, failed: 0, skipped: 3 + 6 });
    expect(r.imported.orders).toBe(9);
    expect(r.imported.attendees).toBe(15);
    const p = await eventbritePreview(o.ctx(), deps, ports, o.eb.connectionId);
    expect(p.events.new + p.ticketTypes.new + p.orders.new).toBe(0);
  });

  it('a refund and a rename at Eventbrite come over on the next run', async () => {
    const o = await importedOrg();
    const acc = account(o.eb.authConnectionId);
    const later = new Date(Date.now() + 60_000);
    expect(eventbriteRemoteRefund(acc, '5550008', later)).toBe(true);
    expect(eventbriteRemoteRename(acc, '555000702', 'Dorothy J. Vaughan', later)).toBe(true);
    await executeCommand(requestSyncCommand, { connectionId: o.eb.connectionId }, o.ctx(), ports);
    await runSync(o.orgId, o.eb.connectionId, deps, ports);
    const r = await executeQuery(importResultQuery, { connectionId: o.eb.connectionId }, o.ctx(), ports);
    expect(r.run).toMatchObject({ pulled: 2, failed: 0 });
    expect(r.imported).toMatchObject({
      orders: 9,
      paidOrders: 7,
      attendees: 15,
      activeAttendees: 13,
      revenue: [
        { currency: 'EUR', totalMinor: 8980 },
        { currency: 'USD', totalMinor: 55259 - 13412 },
      ],
    });
    const [gala] = await q<{ quantity_sold: number }>(
      o.ctx(),
      sql`select quantity_sold from ticketing.ticket_types where name = 'Gala dinner'`,
    );
    expect(gala?.quantity_sold).toBe(2);
    const renamed = await q<{ name: string }>(
      o.ctx(),
      sql`select name from attendees.attendees where email = 'dorothy@eb-buyers.test'`,
    );
    expect(renamed).toEqual([{ name: 'Dorothy J. Vaughan' }]);
  });

  it('disconnect, reconnect and import again: nothing is duplicated', async () => {
    const o = await importedOrg();
    await executeCommand(disconnectCommand, { connectionId: o.eb.connectionId }, o.ctx(), ports);
    const again = await connectEventbrite(o.ctx());
    const p = await eventbritePreview(o.ctx(), deps, ports, again.connectionId);
    expect(p.orders).toEqual({ total: 9, new: 0 });
    await executeCommand(requestSyncCommand, { connectionId: again.connectionId }, o.ctx(), ports);
    expect((await runSync(o.orgId, again.connectionId, deps, ports)).runStatus).toBe('succeeded');
    const r = await executeQuery(importResultQuery, { connectionId: again.connectionId }, o.ctx(), ports);
    expect(r.imported).toMatchObject({ events: 3, ticketTypes: 6, orders: 9, attendees: 15 });
    const [t] = await q<{ events: number; types: number; orders: number }>(
      o.ctx(),
      sql`select (select count(*)::int from events.events) as events, (select count(*)::int from ticketing.ticket_types) as types, (select count(*)::int from orders.orders) as orders`,
    );
    expect(t).toEqual({ events: 3, types: 6, orders: 9 });
  });

  it('a provider outage fails the run into the inbox; the next run completes it', async () => {
    const o = await fresh();
    const eb = await connectEventbrite(o.ctx());
    // Eventbrite answers 503 once: the run fails into the inbox and nothing is half-written.
    await executeCommand(requestSyncCommand, { connectionId: eb.connectionId }, o.ctx(), ports);
    fakeIntegrations.failNext(eb.authConnectionId, 503);
    const first = await runSync(o.orgId, eb.connectionId, deps, ports);
    expect(first.runStatus).toBe('failed');
    expect((await groups(o.ctx())).map((g) => g.code)).toContain('http_503');
    await executeCommand(requestSyncCommand, { connectionId: eb.connectionId }, o.ctx(), ports);
    expect((await runSync(o.orgId, eb.connectionId, deps, ports)).runStatus).toBe('succeeded');
    const r = await executeQuery(importResultQuery, { connectionId: eb.connectionId }, o.ctx(), ports);
    expect(r.imported).toMatchObject({ events: 3, orders: 9, attendees: 15 });
    expect(await groups(o.ctx())).toEqual([]);
  });

  it('only owners and admins preview or start an import; another org sees nothing', async () => {
    const eb = await connectEventbrite(a.ctx());
    const viewer = userCtx(a.viewerId, a.org.id);
    await expectError(eventbritePreview(viewer, deps, ports, eb.connectionId), 'forbidden');
    await expectError(
      executeCommand(requestSyncCommand, { connectionId: eb.connectionId }, viewer, ports),
      'forbidden',
    );
    await expectError(eventbritePreview(b.ctx(), deps, ports, eb.connectionId), 'not_found');
    await expectError(
      executeQuery(importResultQuery, { connectionId: eb.connectionId }, b.ctx(), ports),
      'not_found',
    );
    await executeCommand(disconnectCommand, { connectionId: eb.connectionId }, a.ctx(), ports);
  });
});

/** A fresh org with an imported event (ticket holders) and Google Sheets connected. */
async function sheetsOrg() {
  const o = await importedOrg();
  const sheets = await connectConnector(o.ctx(), 'google_sheets');
  const [jazz] = await q<{ id: string }>(o.ctx(), sql`select id from events.events where name = 'Summer Jazz Night'`);
  if (!jazz) throw new Error('no event');
  return { ...o, sheets, eventId: jazz.id, acc: account(sheets.authConnectionId) };
}

const attendeeRows = (ctx: Ctx, eventId: string) =>
  q<{ id: string; name: string; email: string; labels: string[]; status: string; source: string }>(
    ctx,
    sql`select id, name, email, labels, status, source from attendees.attendees where event_id = ${eventId} order by email`,
  );

describe('Google Sheets live sync', () => {
  it('links an event: a new sheet with the mapping columns, filled with the attendee list', async () => {
    const o = await sheetsOrg();
    const { linkId } = await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    const [link] = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    expect(link).toMatchObject({ id: linkId, eventId: o.eventId, eventName: 'Summer Jazz Night', status: 'active' });
    expect(link?.url).toBe(`https://docs.google.com/spreadsheets/d/${link?.spreadsheetId}/edit`);
    expect(sheetsRemoteList(o.acc)).toEqual([
      { id: link?.spreadsheetId, title: 'Summer Jazz Night · attendees', headers: ['Name', 'Email', 'Labels', 'Status'] },
    ]);
    // The link queued a sync; the push fills the sheet.
    const r = await runSync(o.orgId, o.sheets.connectionId, deps, ports);
    expect(r.runStatus).toBe('succeeded');
    const people = await attendeeRows(o.ctx(), o.eventId);
    const rows = sheetsRemoteRows(o.acc, link?.spreadsheetId as string);
    expect(rows).toHaveLength(people.length);
    expect(rows.map((x) => x.values.email).sort()).toEqual(people.map((p) => p.email).sort());
    expect(rows.find((x) => x.values.email === 'edsger@eb-buyers.test')?.values.status).toBe('cancelled');
    // A second link for the same event is refused; another org cannot link it.
    await expectError(
      linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId }),
      'conflict',
      'already_linked',
    );
    await expectError(
      linkEventSheet(b.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId }),
      'not_found',
    );
  });

  it('round trips without duplicates; a sheet edit and a new row pull; our edit pushes', async () => {
    const o = await sheetsOrg();
    await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    await run(o.orgId, o.sheets.connectionId);
    const [link] = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    const sid = link?.spreadsheetId as string;
    const before = sheetsRemoteRows(o.acc, sid);
    const people = await attendeeRows(o.ctx(), o.eventId);
    // Replayed twice: nothing moves either way.
    for (let i = 0; i < 2; i++) {
      await run(o.orgId, o.sheets.connectionId);
      const d = await executeQuery(connectionDetailQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
      expect(d.runs[0]).toMatchObject({ status: 'succeeded', pulled: 0, pushed: 0, failed: 0 });
    }
    expect(sheetsRemoteRows(o.acc, sid)).toEqual(before);
    expect(await attendeeRows(o.ctx(), o.eventId)).toEqual(people);

    // The organizer fixes a ticket holder's name in the sheet and types in a new guest.
    const charles = before.find((r) => r.values.email === 'charles@eb-buyers.test');
    if (!charles) throw new Error('row');
    sheetsRemoteEdit(o.acc, sid, charles.rowId, { name: 'Charles B. Babbage', labels: 'press, vip' });
    sheetsRemoteAdd(o.acc, sid, { name: 'Walk-in Guest', email: 'Walk.In@sheet.test', labels: '' });
    await run(o.orgId, o.sheets.connectionId);
    const after = await attendeeRows(o.ctx(), o.eventId);
    expect(after).toHaveLength(people.length + 1);
    expect(after.find((p) => p.email === 'charles@eb-buyers.test')).toMatchObject({
      name: 'Charles B. Babbage',
      labels: ['press', 'vip'],
      source: 'ticket',
    });
    expect(after.find((p) => p.email === 'walk.in@sheet.test')).toMatchObject({ name: 'Walk-in Guest', source: 'guest' });
    const [ticket] = await q<{ holder_name: string }>(
      o.ctx(),
      sql`select holder_name from ticketing.tickets where holder_email = 'charles@eb-buyers.test'`,
    );
    expect(ticket?.holder_name).toBe('Charles B. Babbage');
    // Nothing doubles on the next runs (the new guest's row is the one typed in).
    await run(o.orgId, o.sheets.connectionId);
    await run(o.orgId, o.sheets.connectionId);
    expect(sheetsRemoteRows(o.acc, sid)).toHaveLength(before.length + 1);
    expect(await attendeeRows(o.ctx(), o.eventId)).toHaveLength(people.length + 1);

    // Our edit pushes on the next run.
    const grace = after.find((p) => p.email === 'alan@eb-buyers.test');
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId: o.eventId, attendeeIds: [grace?.id as string], add: ['speaker'] },
      o.ctx(),
      ports,
    );
    await run(o.orgId, o.sheets.connectionId);
    const pushed = sheetsRemoteRows(o.acc, sid).find((r) => r.values.email === 'alan@eb-buyers.test');
    expect(pushed?.values.labels).toBe('speaker');
    expect(pushed?.origin).toBe(`yayatoh:${o.sheets.connectionId}`);
    expect(sheetsRemoteRows(o.acc, sid)).toHaveLength(before.length + 1);
  });

  it('a row typed in for someone already on the list is refused into the inbox, never doubled', async () => {
    const o = await sheetsOrg();
    await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    await run(o.orgId, o.sheets.connectionId);
    const [link] = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    const people = await attendeeRows(o.ctx(), o.eventId);
    sheetsRemoteAdd(o.acc, link?.spreadsheetId as string, { name: 'Ada again', email: 'ada@eb-buyers.test' });
    await run(o.orgId, o.sheets.connectionId);
    expect(await attendeeRows(o.ctx(), o.eventId)).toHaveLength(people.length);
    const g = (await groups(o.ctx())).find((x) => x.step === 'write');
    expect(g).toMatchObject({ connector: 'google_sheets', code: 'conflict', count: 1 });
  });

  it('deleting a row never deletes the attendee: it is flagged until dismissed', async () => {
    const o = await sheetsOrg();
    await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    await run(o.orgId, o.sheets.connectionId);
    const [link] = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    const sid = link?.spreadsheetId as string;
    const people = await attendeeRows(o.ctx(), o.eventId);
    const grace = sheetsRemoteRows(o.acc, sid).find((r) => r.values.email === 'grace@eb-buyers.test');
    expect(sheetsRemoteDelete(o.acc, sid, grace?.rowId as string)).toBe(true);
    await run(o.orgId, o.sheets.connectionId);
    await run(o.orgId, o.sheets.connectionId);
    expect(await attendeeRows(o.ctx(), o.eventId)).toEqual(people);
    const flagged = (await groups(o.ctx())).filter((x) => x.code === 'remote_deleted');
    expect(flagged).toHaveLength(1);
    const row = flagged[0]?.errors[0];
    expect(row).toMatchObject({
      localId: people.find((p) => p.email === 'grace@eb-buyers.test')?.id,
      occurrences: 2,
      nextRetryAt: null,
      retryable: false,
    });
    // Retry does not apply to it; Dismiss accepts the deletion and the flag stays gone.
    const retried = await executeCommand(retryErrorsCommand, { errorIds: [row?.id as string] }, o.ctx(), ports);
    expect(retried).toMatchObject({ retried: 0, skipped: 1 });
    await executeCommand(dismissErrorsCommand, { errorIds: [row?.id as string] }, o.ctx(), ports);
    await run(o.orgId, o.sheets.connectionId);
    expect((await groups(o.ctx())).filter((x) => x.code === 'remote_deleted')).toEqual([]);
    expect(await attendeeRows(o.ctx(), o.eventId)).toEqual(people);
  });

  it('conflicts: the later writer wins and the losing value is in the inbox', async () => {
    const o = await sheetsOrg();
    await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    await run(o.orgId, o.sheets.connectionId);
    const [link] = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    const sid = link?.spreadsheetId as string;
    const rows = sheetsRemoteRows(o.acc, sid);
    const people = await attendeeRows(o.ctx(), o.eventId);
    const joan = people.find((p) => p.email === 'joan@eb-buyers.test');
    const hedy = people.find((p) => p.email === 'hedy@eb-buyers.test');
    // Joan: the sheet changed first, Yayatoh later → Yayatoh's value is kept.
    sheetsRemoteEdit(o.acc, sid, rows.find((r) => r.values.email === joan?.email)?.rowId as string, { labels: 'from-sheet' }, new Date(Date.now() - 120_000));
    await executeCommand(setAttendeeLabelsCommand, { eventId: o.eventId, attendeeIds: [joan?.id as string], add: ['from-yayatoh'] }, o.ctx(), ports);
    // Hedy: Yayatoh changed first, the sheet later → the sheet's value is kept.
    await executeCommand(setAttendeeLabelsCommand, { eventId: o.eventId, attendeeIds: [hedy?.id as string], add: ['ours'] }, o.ctx(), ports);
    sheetsRemoteEdit(o.acc, sid, rows.find((r) => r.values.email === hedy?.email)?.rowId as string, { labels: 'theirs' }, new Date(Date.now() + 120_000));
    await run(o.orgId, o.sheets.connectionId);
    const after = await attendeeRows(o.ctx(), o.eventId);
    expect(after.find((p) => p.id === joan?.id)?.labels).toEqual(['from-yayatoh']);
    expect(after.find((p) => p.id === hedy?.id)?.labels).toEqual(['theirs']);
    const sheet = sheetsRemoteRows(o.acc, sid);
    expect(sheet.find((r) => r.values.email === joan?.email)?.values.labels).toBe('from-yayatoh');
    expect(sheet.find((r) => r.values.email === hedy?.email)?.values.labels).toBe('theirs');
    const conflicts = (await groups(o.ctx())).filter((g) => g.step === 'conflict');
    const kept = conflicts.find((g) => g.code === 'conflict_kept_yayatoh');
    const lost = conflicts.find((g) => g.code === 'conflict_kept_remote');
    expect(kept?.errors[0]).toMatchObject({
      localId: joan?.id,
      retryable: false,
      conflict: [{ field: 'labels', kept: 'from-yayatoh', lost: 'from-sheet' }],
    });
    expect(lost?.errors[0]).toMatchObject({
      localId: hedy?.id,
      conflict: [{ field: 'labels', kept: 'theirs', lost: 'ours' }],
    });
    // Settled: the next run raises nothing new, and a dismissed conflict takes its values with it.
    await run(o.orgId, o.sheets.connectionId);
    expect((await groups(o.ctx())).filter((g) => g.step === 'conflict').map((g) => g.count)).toEqual([1, 1]);
    await executeCommand(dismissErrorsCommand, { errorIds: [kept?.errors[0]?.id as string] }, o.ctx(), ports);
    const [left] = await q<{ n: number }>(o.ctx(), sql`select count(*)::int as n from integrations.sync_conflicts`);
    expect(left?.n).toBe(1);
  });

  it('unlink stops the sync and keeps everyone; linking again starts a new sheet', async () => {
    const o = await sheetsOrg();
    await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    await run(o.orgId, o.sheets.connectionId);
    const [link] = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    const sid = link?.spreadsheetId as string;
    const people = await attendeeRows(o.ctx(), o.eventId);
    // Someone who is not a member of the org.
    const viewer = userCtx(uuidv7(), o.orgId);
    await expectError(
      executeCommand(unlinkSheetCommand, { connectionId: o.sheets.connectionId, linkId: link?.id as string }, viewer, ports),
      'forbidden',
    );
    await executeCommand(unlinkSheetCommand, { connectionId: o.sheets.connectionId, linkId: link?.id as string }, o.ctx(), ports);
    await expectError(
      executeCommand(unlinkSheetCommand, { connectionId: o.sheets.connectionId, linkId: link?.id as string }, o.ctx(), ports),
      'invalid_state',
    );
    sheetsRemoteDelete(o.acc, sid, sheetsRemoteRows(o.acc, sid)[0]?.rowId as string);
    sheetsRemoteAdd(o.acc, sid, { name: 'Ignored', email: 'ignored@sheet.test' });
    await run(o.orgId, o.sheets.connectionId);
    expect(await attendeeRows(o.ctx(), o.eventId)).toEqual(people);
    expect(await groups(o.ctx())).toEqual([]);
    await linkEventSheet(o.ctx(), deps, ports, { connectionId: o.sheets.connectionId, eventId: o.eventId });
    await run(o.orgId, o.sheets.connectionId);
    const links = await executeQuery(sheetLinksQuery, { connectionId: o.sheets.connectionId }, o.ctx(), ports);
    expect(links.map((l) => l.status)).toEqual(['active', 'unlinked']);
    expect(links[0]?.spreadsheetId).not.toBe(sid);
    expect(sheetsRemoteRows(o.acc, links[0]?.spreadsheetId as string)).toHaveLength(people.length);
  });

  it('viewers cannot link; a guest event of the fixture org syncs; another org is refused', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const [sheets] = await q<{ id: string }>(
      a.ctx(),
      sql`select id from integrations.connections where connector = 'google_sheets' and status = 'active'`,
    );
    const other = await executeCommand(
      createEventCommand,
      {
        name: `Sheets ${tag}`,
        timezone: 'UTC',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
      },
      a.ctx(),
      ports,
    );
    await expectError(
      linkEventSheet(viewer, deps, ports, { connectionId: sheets?.id as string, eventId: other.id }),
      'forbidden',
    );
    await expectError(
      executeCommand(
        linkSheetCommand,
        { connectionId: sheets?.id as string, eventId: other.id, spreadsheetId: 'x1', title: 'x' },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
    await executeCommand(addGuestCommand, { eventId: other.id, name: 'Only Guest', email: `only.${tag}@guest.test` }, a.ctx(), ports);
    await linkEventSheet(a.ctx(), deps, ports, { connectionId: sheets?.id as string, eventId: other.id });
    expect((await run(a.org.id, sheets?.id as string)).runStatus).toBe('succeeded');
    const list = await executeQuery(listAttendeesQuery, { eventId: other.id }, a.ctx(), ports);
    expect(list.total).toBe(1);
    const ev = await executeQuery(getEventQuery, { eventId: other.id }, a.ctx(), ports);
    expect(ev.id).toBe(other.id);
  });

  it('no fake token or canary reaches an error the code threw', () => {
    expect(findCanaries(JSON.stringify(thrown.map((e) => (e instanceof Error ? e.message : e))))).toEqual([]);
  });
});
