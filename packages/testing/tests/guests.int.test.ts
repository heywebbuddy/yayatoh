import {
  addGuestCommand,
  attendeeEmailBulk,
  attendeeMessageMailer,
  listAttendeesQuery,
  removeGuestCommand,
} from '@yayatoh/attendees';
import { scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, findEventTx, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken, startCheckoutCommand } from '@yayatoh/orders';
import { consumeEvent, memoryMailer } from '@yayatoh/platform';
import { contactTimelineQuery } from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let gala: string;
let concert: string;
const DURING = new Date('2027-12-01T20:00:00Z');

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const mk = async (name: string) =>
    (
      await executeCommand(
        createEventCommand,
        { name, timezone: 'UTC', startsAt: '2027-12-01T18:00:00Z', endsAt: '2027-12-01T23:00:00Z' },
        a.ctx(),
        ports,
      )
    ).id;
  gala = await mk('Winter Gala');
  concert = await mk('Spring Concert');
  const t = await executeCommand(
    createTicketTypeCommand,
    { eventId: concert, name: 'GA', priceMinor: 0, quantityTotal: 10 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: concert, transition: 'publish' }, a.ctx(), ports);
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: concert,
      items: [{ ticketTypeId: t.id, quantity: 1 }],
      buyer: { email: 'Rita@Example.test', name: 'Rita' },
    },
    createCtx({ orgId: a.org.id }),
    ports,
  );
  const code = (await orderByManageToken(r.manageToken))?.tickets[0]?.shortCode ?? '';
  await executeCommand(scanTicketCommand, { eventId: concert, code }, a.ctx({ now: DURING }), ports);
});
afterAll(closePools);

const guest = (name: string, email: string, labels: string[] = []) =>
  executeCommand(addGuestCommand, { eventId: gala, name, email, labels }, a.ctx(), ports);

describe('guest lists, bulk email and the contact timeline (M1.8e)', () => {
  it('adds guests by hand, one per email; removes them without deleting history', async () => {
    const g = await guest('Rita', 'rita@example.test', ['Family']);
    expect(g).toMatchObject({ source: 'guest', labels: ['Family'], status: 'active' });
    await expect(guest('Rita Again', 'RITA@example.test')).rejects.toMatchObject({ code: 'conflict' });
    const tom = await guest('Tom', 'tom@example.test', ['Family']);
    await executeCommand(removeGuestCommand, { eventId: gala, attendeeId: tom.id }, a.ctx(), ports);
    expect(
      (await executeQuery(listAttendeesQuery, { eventId: gala, status: 'cancelled' }, a.ctx(), ports)).total,
    ).toBe(1);
    // Removed guests can be added back.
    await guest('Tom', 'tom@example.test');
    await expect(
      executeCommand(
        addGuestCommand,
        { eventId: gala, name: 'X', email: 'x@example.test' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Ticket holders leave the list by cancelling the ticket, not here.
    const [holder] = (await executeQuery(listAttendeesQuery, { eventId: concert }, a.ctx(), ports)).items;
    await expect(
      executeCommand(
        removeGuestCommand,
        { eventId: concert, attendeeId: holder?.id as string },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('emails the selected guests once each; removed guests are skipped; replays never resend', async () => {
    const op = await executeCommand(
      attendeeEmailBulk.start,
      {
        eventId: gala,
        selection: { filter: {} },
        params: { subject: 'Dress code', body: 'Black tie, please.' },
      },
      a.ctx(),
      ports,
    );
    expect(op.total).toBe(3);
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const st = await executeQuery(attendeeEmailBulk.status, { operationId: op.operationId }, a.ctx(), ports);
    expect(st).toMatchObject({ succeeded: 2, failed: 1, failures: [{ code: 'not_attending' }] });
    const [evt] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; payload: unknown; aggregate_id: string }>(
        sql`select id, payload, aggregate_id from platform.domain_events where type = 'attendees.message_batch' and aggregate_id = ${op.operationId}`,
      ),
    );
    const { mailer, sent } = memoryMailer();
    const sub = attendeeMessageMailer({
      mailer,
      eventName: async (tx, id) => (await findEventTx(tx, id))?.name ?? null,
    });
    const published = {
      id: evt?.id as string,
      orgId: a.org.id,
      type: 'attendees.message_batch',
      version: 1,
      aggregateType: 'bulk_operation',
      aggregateId: op.operationId,
      payload: evt?.payload,
      logSeq: 1,
    };
    expect(await consumeEvent(sub, published)).toBe(true);
    expect(await consumeEvent(sub, published)).toBe(false);
    expect(sent.map((m) => m.to).sort()).toEqual(['rita@example.test', 'tom@example.test']);
    expect(sent[0]).toMatchObject({
      template: 'attendees.message',
      params: { subject: 'Dress code', body: 'Black tie, please.', eventName: 'Winter Gala' },
    });
    expect(new Set(sent.map((m) => m.idempotencyKey)).size).toBe(2);
  });

  it('the contact timeline shows one person across events: tickets, orders, check-ins, guest lists', async () => {
    const [ritaAtConcert] = (
      await executeQuery(listAttendeesQuery, { eventId: concert, search: 'rita' }, a.ctx(), ports)
    ).items;
    const tl = await executeQuery(
      contactTimelineQuery,
      { attendeeId: ritaAtConcert?.id as string },
      a.ctx(),
      ports,
    );
    expect(tl.events).toBe(2);
    expect(tl.items.map((i) => `${i.kind}:${i.eventName}`).sort()).toEqual(
      [
        'checked_in:Spring Concert',
        'guest:Winter Gala',
        'order:Spring Concert',
        'ticket:Spring Concert',
      ].sort(),
    );
    expect(tl.items.find((i) => i.kind === 'order')).toMatchObject({ amountMinor: 0, status: 'paid' });
    // Newest first.
    expect(tl.items.map((i) => i.at.getTime())).toEqual(
      [...tl.items.map((i) => i.at.getTime())].sort((x, y) => y - x),
    );
    await expect(
      executeQuery(
        contactTimelineQuery,
        { attendeeId: ritaAtConcert?.id as string },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(contactTimelineQuery, { attendeeId: ritaAtConcert?.id as string }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
