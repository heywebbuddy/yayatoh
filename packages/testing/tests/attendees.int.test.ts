import { listAttendeesQuery } from '@yayatoh/attendees';
import { currentConsentTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { startCheckoutCommand } from '@yayatoh/orders';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
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
