import {
  attendeeLabelsQuery,
  listAttendeesQuery,
  searchAttendeesQuery,
  setAttendeeLabelsCommand,
} from '@yayatoh/attendees';
import { currentConsentTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { searchOrdersQuery, startCheckoutCommand } from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand, findTicketsByCodeQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
let free: { id: string };

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    { name: 'Attendees', timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
    a.ctx(),
    ports,
  );
  eventId = e.id;
  free = await executeCommand(
    createTicketTypeCommand,
    { eventId, name: 'Free', priceMinor: 0, quantityTotal: 100, maxPerOrder: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, a.ctx(), ports);
});
afterAll(closePools);

const buy = (quantity: number, email: string, name: string, marketingOptIn?: boolean) =>
  executeCommand(
    startCheckoutCommand,
    { eventId, items: [{ ticketTypeId: free.id, quantity }], buyer: { email, name }, marketingOptIn },
    createCtx({ orgId: a.org.id }),
    ports,
  );

const contactsFor = (email: string) =>
  withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ id: string; name: string }>(
      sql`select id, name from crm.contacts where email_norm = ${email.toLowerCase()}`,
    ),
  );

describe('contacts and attendees', () => {
  it('one contact per email per org, whatever the case; the first name sticks', async () => {
    await buy(1, 'Ada@Example.test', 'Ada Lovelace');
    await buy(1, 'ada@example.TEST', 'A. Lovelace');
    const rows = await contactsFor('ada@example.test');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Ada Lovelace');
  });

  it('buying is not consent; only the explicit opt-in records it, with evidence', async () => {
    await buy(1, 'noconsent@example.test', 'No Consent');
    await buy(1, 'yes@example.test', 'Yes Please', true);
    const [no] = await contactsFor('noconsent@example.test');
    const [yes] = await contactsFor('yes@example.test');
    await withTenant(systemCtx(a.org.id), async (tx) => {
      expect(await currentConsentTx(tx, no?.id ?? '', 'email', 'marketing')).toBeNull();
      expect(await currentConsentTx(tx, yes?.id ?? '', 'email', 'marketing')).toBe('granted');
      const [ev] = await tx.execute<{ evidence: string }>(
        sql`select evidence from crm.consents where contact_id = ${yes?.id ?? ''}`,
      );
      expect(ev?.evidence).toBe(`checkout_checkbox:event:${eventId}`);
    });
  });

  it('each issued ticket has its own attendee, linked both ways', async () => {
    const r = await buy(3, 'group@example.test', 'Group Lead');
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ ticket_id: string; attendee_id: string; a_ticket: string; contact: string }>(sql`
        select t.id as ticket_id, t.attendee_id, a.ticket_id as a_ticket, a.contact_id as contact
        from ticketing.tickets t join attendees.attendees a on a.id = t.attendee_id
        where t.order_id = ${r.order.id}`),
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((x) => x.attendee_id)).size).toBe(3);
    for (const x of rows) expect(x.a_ticket).toBe(x.ticket_id);
    expect(new Set(rows.map((x) => x.contact)).size).toBe(1);
  });

  it('organizers list and search attendees; LIKE wildcards are literal', async () => {
    const all = await executeQuery(listAttendeesQuery, { eventId }, a.ctx(), ports);
    expect(all.total).toBe(7);
    expect(Object.keys(all.items[0] ?? {})).not.toContain('contactId');
    const found = await executeQuery(listAttendeesQuery, { eventId, search: 'lovelace' }, a.ctx(), ports);
    expect(found.items.map((x) => x.name).sort()).toEqual(['A. Lovelace', 'Ada Lovelace']);
    const wild = await executeQuery(listAttendeesQuery, { eventId, search: '%' }, a.ctx(), ports);
    expect(wild.total).toBe(0);
  });

  it('a viewer can read attendees; a scanner cannot', async () => {
    await expect(
      executeQuery(listAttendeesQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).resolves.toBeTruthy();
    const scanner = uuidv7();
    await executeCommand(addMemberCommand, { userId: scanner, role: 'scanner' }, a.ctx(), ports);
    await expect(
      executeQuery(listAttendeesQuery, { eventId }, userCtx(scanner, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('isolation: org B sees none of org A contacts or attendees', async () => {
    const res = await executeQuery(listAttendeesQuery, { eventId }, b.ctx(), ports);
    expect(res.total).toBe(0);
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from crm.contacts where email_norm = 'ada@example.test'`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe('filters, labels and search (M1.8a)', () => {
  const list = (extra: Record<string, unknown> = {}) =>
    executeQuery(listAttendeesQuery, { eventId, ...extra }, a.ctx(), ports);
  const ids = async (search: string) => (await list({ search })).items.map((x) => x.id);
  const label = (attendeeIds: string[], add: string[], remove: string[] = [], ctx = a.ctx()) =>
    executeCommand(setAttendeeLabelsCommand, { eventId, attendeeIds, add, remove }, ctx, ports);

  it('labels attendees in bulk (normalized, deduplicated); removal wins; labels filter the list', async () => {
    const group = await ids('group@example.test');
    expect(group).toHaveLength(3);
    await label(group, ['  VIP ', 'Table  4', 'VIP']);
    await label(group.slice(0, 1), ['Speaker'], ['Table 4']);
    const vip = await list({ labels: ['VIP'] });
    expect(vip.total).toBe(3);
    expect(vip.items.find((x) => x.id === group[0])?.labels).toEqual(['Speaker', 'VIP']);
    expect((await list({ labels: ['Table 4', 'Speaker'] })).total).toBe(3);
    expect((await list({ labels: ['Nobody'] })).total).toBe(0);
    expect(await executeQuery(attendeeLabelsQuery, { eventId }, a.ctx(), ports)).toEqual([
      { label: 'VIP', count: 3 },
      { label: 'Table 4', count: 2 },
      { label: 'Speaker', count: 1 },
    ]);
  });

  it('filters by source and status and pages with offset', async () => {
    expect((await list({ source: 'ticket' })).total).toBe(7);
    expect((await list({ source: 'import' })).total).toBe(0);
    expect((await list({ status: 'cancelled' })).total).toBe(0);
    const p1 = await list({ limit: 4 });
    const p2 = await list({ limit: 4, offset: 4 });
    expect(p1.items).toHaveLength(4);
    expect(p2.items).toHaveLength(3);
    expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(7);
  });

  it('at most 20 labels per attendee; unknown attendees and viewers are refused', async () => {
    const [one] = await ids('noconsent@example.test');
    const many = Array.from({ length: 20 }, (_, i) => `L${i}`);
    await label([one as string], many);
    await expect(label([one as string], ['One more'])).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(label([uuidv7()], ['X'])).rejects.toMatchObject({ code: 'not_found' });
    await expect(label([one as string], [])).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(label([one as string], ['X'], [], userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await label([one as string], [], many);
  });

  it('org-wide search finds attendees, orders and tickets by name, email or code', async () => {
    const hits = await executeQuery(searchAttendeesQuery, { q: 'lovelace' }, a.ctx(), ports);
    expect(hits.map((h) => h.name).sort()).toEqual(['A. Lovelace', 'Ada Lovelace']);
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual(['email', 'eventId', 'id', 'name', 'ticketId']);
    const orders = await executeQuery(searchOrdersQuery, { q: 'GROUP@example' }, a.ctx(), ports);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ buyerName: 'Group Lead', eventId });
    const byId = await executeQuery(
      searchOrdersQuery,
      { q: (orders[0] as { id: string }).id.slice(0, 13) },
      a.ctx(),
      ports,
    );
    expect(byId.map((o) => o.id)).toEqual([orders[0]?.id]);
    // A ticket's short code (any case) → the ticket → its attendee.
    const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ short_code: string; id: string }>(
        sql`select short_code, id from ticketing.tickets where event_id = ${eventId} order by serial limit 1`,
      ),
    );
    const tickets = await executeQuery(
      findTicketsByCodeQuery,
      { code: (t?.short_code ?? '').toLowerCase() },
      a.ctx(),
      ports,
    );
    expect(tickets.map((x) => x.id)).toEqual([t?.id]);
    const viaTicket = await executeQuery(
      searchAttendeesQuery,
      { q: t?.short_code ?? '', ticketIds: [t?.id ?? ''] },
      a.ctx(),
      ports,
    );
    expect(viaTicket.map((h) => h.ticketId)).toEqual([t?.id]);
    expect(await executeQuery(findTicketsByCodeQuery, { code: 'not a code' }, a.ctx(), ports)).toEqual([]);
  });

  it('isolation: org B search finds nothing of org A', async () => {
    expect(await executeQuery(searchAttendeesQuery, { q: 'lovelace' }, b.ctx(), ports)).toEqual([]);
    expect(await executeQuery(searchOrdersQuery, { q: 'group@example' }, b.ctx(), ports)).toEqual([]);
    const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ short_code: string }>(
        sql`select short_code from ticketing.tickets where event_id = ${eventId} limit 1`,
      ),
    );
    expect(await executeQuery(findTicketsByCodeQuery, { code: t?.short_code ?? '' }, b.ctx(), ports)).toEqual(
      [],
    );
  });
});
