import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  cancelOccurrenceCommand,
  createEventCommand,
  transitionEventCommand,
  updateEventCommand,
  updateOccurrenceCommand,
} from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  createNotifier,
  type DeliveryEvent,
  dispatchDue,
  emailPreviewQuery,
  memoryTransports,
  orderMessagesQuery,
  PREVIEW_MAX_BYTES,
  recordDeliveryEventsCommand,
  rescheduleRemindersTx,
  storeEmailPreviewCommand,
} from '@yayatoh/notifications';
import { reminderRescheduler, startCheckoutCommand, ticketMailer } from '@yayatoh/orders';
import { consumeEvent, type PublishedEvent, recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
let a: OrgFixture;
let b: OrgFixture;
const notifier = createNotifier();
const mailer = ticketMailer({ notifier, appOrigin: ORIGIN });
const rescheduler = reminderRescheduler();

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

async function publishedEvent(org: OrgFixture, fields: Record<string, unknown>) {
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Show ${uuidv7().slice(-6)}`,
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T23:00:00Z',
      endsAt: '2030-06-02T03:00:00Z',
      venueName: 'Pier 9',
      ...fields,
    },
    org.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: ev.id, name: 'Free', priceMinor: 0, quantityTotal: 500 },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return { ev, tt };
}

async function events(orgId: string, type: string, aggregateId: string): Promise<PublishedEvent[]> {
  return (await withTenant(systemCtx(orgId), (tx) => recentEventsTx(tx, orgId, [type], 3_600_000))).filter(
    (e) => e.aggregateId === aggregateId,
  );
}

async function buyAndMail(
  org: OrgFixture,
  eventId: string,
  ticketTypeId: string,
  email: string,
  occurrenceId?: string,
) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      buyer: { email, name: 'Rae Buyer' },
      ...(occurrenceId ? { occurrenceId } : {}),
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
  const [paid] = await events(org.org.id, 'order.paid', r.order.id);
  if (!paid) throw new Error('no order.paid event');
  await consumeEvent(mailer, paid);
  return r;
}

type MessageRow = {
  id: string;
  kind: string;
  status: string;
  reason: string | null;
  send_after: string;
  delivery: string | null;
  occurrence_id: string | null;
};
const rows = (orgId: string, where: ReturnType<typeof sql>) =>
  withTenant(systemCtx(orgId), (tx) =>
    tx.execute<MessageRow>(
      sql`select id, kind, status, reason, send_after, delivery, occurrence_id from notifications.messages where ${where} order by created_at`,
    ),
  );
const reminderOf = async (orgId: string, orderId: string) =>
  (await rows(orgId, sql`order_id = ${orderId} and kind = 'events.reminder'`))[0];

/** Consume every rescheduling event of an event (new and old: consumers dedupe per event id). */
async function reschedule(orgId: string, eventId: string) {
  const types = rescheduler.events.map((e) => e.split('@')[0] as string);
  const list = (
    await withTenant(systemCtx(orgId), (tx) => recentEventsTx(tx, orgId, types, 3_600_000))
  ).filter((e) => e.aggregateId === eventId);
  for (const e of list) await consumeEvent(rescheduler, e);
  return list;
}

describe('reminders follow reschedules', () => {
  it('moving the event moves its queued reminder and the email shows the new time', async () => {
    const { ev, tt } = await publishedEvent(a, {});
    const r = await buyAndMail(a, ev.id, tt.id, `move-${uuidv7()}@example.test`);
    expect(new Date((await reminderOf(a.org.id, r.order.id))?.send_after ?? '').toISOString()).toBe(
      '2030-05-31T23:00:00.000Z',
    );
    // 18:00 CDT on June 8 → reminder 18:00 CDT on June 7.
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.id,
        startsAt: new Date('2030-06-08T23:00:00Z'),
        endsAt: new Date('2030-06-09T03:00:00Z'),
      },
      a.ctx(),
      ports,
    );
    await reschedule(a.org.id, ev.id);
    const moved = await reminderOf(a.org.id, r.order.id);
    expect(moved).toMatchObject({ status: 'queued', reason: null });
    expect(new Date(moved?.send_after ?? '').toISOString()).toBe('2030-06-07T23:00:00.000Z');

    // Sent early (dev tooling), the email carries the new time in the event's timezone.
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, {
      transports,
      appOrigin: ORIGIN,
      ignoreQuietHours: true,
      includeScheduled: true,
    });
    const mail = emails.find((e) => e.subject === `Tomorrow: ${ev.name}` && e.text.includes('Rae'));
    expect(mail?.text).toContain('Saturday, June 8, 2030 at 6:00 PM');
  });

  it('is idempotent: replays and a second pass change nothing', async () => {
    const { ev, tt } = await publishedEvent(a, {});
    const r = await buyAndMail(a, ev.id, tt.id, `idem-${uuidv7()}@example.test`);
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.id,
        startsAt: new Date('2030-07-01T23:00:00Z'),
        endsAt: new Date('2030-07-02T03:00:00Z'),
      },
      a.ctx(),
      ports,
    );
    const [updated] = await reschedule(a.org.id, ev.id);
    const before = await reminderOf(a.org.id, r.order.id);
    // The same change delivered again under another event id (a replayed relay), twice at once.
    if (!updated) throw new Error('no event.updated');
    await Promise.all([
      consumeEvent(rescheduler, { ...updated, id: uuidv7() }),
      consumeEvent(rescheduler, { ...updated, id: uuidv7() }),
    ]);
    expect(await reminderOf(a.org.id, r.order.id)).toEqual(before);
    const again = await withTenant(systemCtx(a.org.id), (tx) =>
      rescheduleRemindersTx(
        tx,
        a.org.id,
        ev.id,
        () => ({
          startsAt: new Date('2030-07-01T23:00:00Z'),
          timeZone: 'America/Chicago',
          eventName: ev.name,
          venue: 'Pier 9',
        }),
        new Date(),
      ),
    );
    expect(again).toEqual({ rescheduled: 0, canceled: 0, unchanged: 1 });
  });

  it('a date (M1.4b) moving moves only its own reminders; a cancelled date cancels them', async () => {
    const { ev, tt } = await publishedEvent(a, {});
    const [d1, d2] = await executeCommand(
      addOccurrencesCommand,
      {
        eventId: ev.id,
        dates: [
          { startsAt: new Date('2030-09-01T23:00:00Z'), endsAt: new Date('2030-09-02T02:00:00Z') },
          { startsAt: new Date('2030-09-08T23:00:00Z'), endsAt: new Date('2030-09-09T02:00:00Z') },
        ],
      },
      a.ctx(),
      ports,
    );
    if (!d1 || !d2) throw new Error('no dates');
    const email = `dates-${uuidv7()}@example.test`;
    const o1 = await buyAndMail(a, ev.id, tt.id, email, d1.id);
    const o2 = await buyAndMail(a, ev.id, tt.id, email, d2.id);
    const r1 = await reminderOf(a.org.id, o1.order.id);
    const r2 = await reminderOf(a.org.id, o2.order.id);
    // One reminder per buyer and date, each the day before its own date.
    expect(r1?.occurrence_id).toBe(d1.id);
    expect(new Date(r1?.send_after ?? '').toISOString()).toBe('2030-08-31T23:00:00.000Z');
    expect(new Date(r2?.send_after ?? '').toISOString()).toBe('2030-09-07T23:00:00.000Z');

    await executeCommand(
      updateOccurrenceCommand,
      {
        scope: 'one',
        occurrenceId: d1.id,
        startsAt: new Date('2030-09-03T01:00:00Z'),
        endsAt: new Date('2030-09-03T04:00:00Z'),
      },
      a.ctx(),
      ports,
    );
    await reschedule(a.org.id, ev.id);
    expect(new Date((await reminderOf(a.org.id, o1.order.id))?.send_after ?? '').toISOString()).toBe(
      '2030-09-02T01:00:00.000Z',
    );
    expect(await reminderOf(a.org.id, o2.order.id)).toEqual(r2);

    await executeCommand(cancelOccurrenceCommand, { occurrenceId: d2.id }, a.ctx(), ports);
    await reschedule(a.org.id, ev.id);
    expect(await reminderOf(a.org.id, o2.order.id)).toMatchObject({
      status: 'canceled',
      reason: 'event_cancelled',
    });
  });

  it('a postponed event parks its reminders; rescheduling it queues them again', async () => {
    const { ev, tt } = await publishedEvent(a, {});
    const r = await buyAndMail(a, ev.id, tt.id, `park-${uuidv7()}@example.test`);
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'postpone' }, a.ctx(), ports);
    await reschedule(a.org.id, ev.id);
    expect(await reminderOf(a.org.id, r.order.id)).toMatchObject({
      status: 'canceled',
      reason: 'event_postponed',
    });
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.id,
        startsAt: new Date('2030-10-10T23:00:00Z'),
        endsAt: new Date('2030-10-11T03:00:00Z'),
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      transitionEventCommand,
      { eventId: ev.id, transition: 'reschedule' },
      a.ctx(),
      ports,
    );
    await reschedule(a.org.id, ev.id);
    const back = await reminderOf(a.org.id, r.order.id);
    expect(back).toMatchObject({ status: 'queued', reason: null });
    expect(new Date(back?.send_after ?? '').toISOString()).toBe('2030-10-09T23:00:00.000Z');
  });

  it('never touches another org’s reminders', async () => {
    const { ev, tt } = await publishedEvent(b, {});
    const r = await buyAndMail(b, ev.id, tt.id, `iso-${uuidv7()}@example.test`);
    const before = await reminderOf(b.org.id, r.order.id);
    const n = await withTenant(systemCtx(a.org.id), (tx) =>
      rescheduleRemindersTx(
        tx,
        a.org.id,
        ev.id,
        () => ({ startsAt: new Date('2031-01-01T00:00:00Z'), timeZone: 'UTC', eventName: 'x', venue: '' }),
        new Date(),
      ),
    );
    expect(n).toEqual({ rescheduled: 0, canceled: 0, unchanged: 0 });
    expect(await reminderOf(b.org.id, r.order.id)).toEqual(before);
  });
});

describe('delivery events and suppression', () => {
  const event = (
    m: { id: string },
    e: Partial<DeliveryEvent> & Pick<DeliveryEvent, 'type'>,
  ): DeliveryEvent => ({
    id: `evt-${uuidv7()}`,
    bounceType: null,
    messageId: m.id,
    providerMessageId: null,
    recipient: null,
    detail: null,
    occurredAt: new Date(),
    ...e,
  });
  const record = (orgId: string, list: DeliveryEvent[]) =>
    executeCommand(recordDeliveryEventsCommand, { provider: 'fake', events: list }, systemCtx(orgId), ports);
  const ticketsOf = async (orgId: string, orderId: string) =>
    (await rows(orgId, sql`order_id = ${orderId} and kind = 'orders.tickets'`))[0] as MessageRow;

  it('a hard bounce is recorded once, suppresses the address, and later tickets show "suppressed"', async () => {
    const { ev, tt } = await publishedEvent(a, {});
    const address = `bounce-${uuidv7()}@example.test`;
    const first = await buyAndMail(a, ev.id, tt.id, address);
    const { transports } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN });
    const sent = await ticketsOf(a.org.id, first.order.id);
    expect(sent.status).toBe('sent');

    const bounce = event(sent, { type: 'bounced', bounceType: 'hard', detail: '550 5.1.1' });
    expect(await record(a.org.id, [bounce])).toEqual({
      recorded: 1,
      duplicate: 0,
      unknown: 0,
      suppressed: 1,
    });
    // The provider retries the webhook: deduplicated by its event id.
    expect(await record(a.org.id, [bounce])).toEqual({
      recorded: 0,
      duplicate: 1,
      unknown: 0,
      suppressed: 0,
    });
    expect((await ticketsOf(a.org.id, first.order.id)).delivery).toBe('bounced');
    const log = await executeQuery(orderMessagesQuery, { orderId: first.order.id }, a.ctx(), ports);
    expect(log.find((m) => m.kind === 'orders.tickets')).toMatchObject({
      status: 'sent',
      delivery: 'bounced',
    });

    // Transactional mail to the address is now suppressed (and says why), in the log too.
    const second = await buyAndMail(a, ev.id, tt.id, address.toUpperCase());
    const mem = memoryTransports();
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN });
    expect(mem.emails.filter((e) => e.to.toLowerCase() === address)).toHaveLength(0);
    expect(await ticketsOf(a.org.id, second.order.id)).toMatchObject({
      status: 'suppressed',
      reason: 'bounced',
    });
    const log2 = await executeQuery(orderMessagesQuery, { orderId: second.order.id }, a.ctx(), ports);
    expect(log2.find((m) => m.kind === 'orders.tickets')).toMatchObject({
      status: 'suppressed',
      reason: 'bounced',
    });
    // Another org still mails that address.
    const other = await publishedEvent(b, {});
    const inB = await buyAndMail(b, other.ev.id, other.tt.id, address);
    const memB = memoryTransports();
    await dispatchDue(b.org.id, { transports: memB.transports, appOrigin: ORIGIN });
    expect((await ticketsOf(b.org.id, inB.order.id)).status).toBe('sent');
  });

  it('complaints suppress; soft bounces only when they repeat; late "delivered" never hides a bounce', async () => {
    const { ev, tt } = await publishedEvent(a, {});
    const addr = `soft-${uuidv7()}@example.test`;
    const sends: MessageRow[] = [];
    for (const _ of [1, 2, 3]) {
      const o = await buyAndMail(a, ev.id, tt.id, addr);
      await dispatchDue(a.org.id, { transports: memoryTransports().transports, appOrigin: ORIGIN });
      sends.push(await ticketsOf(a.org.id, o.order.id));
    }
    const [s1, s2, s3] = sends as [MessageRow, MessageRow, MessageRow];
    const soft = (m: MessageRow, minutes: number) =>
      event(m, { type: 'bounced', bounceType: 'soft', occurredAt: new Date(Date.now() + minutes * 60_000) });
    expect((await record(a.org.id, [soft(s1, 0)])).suppressed).toBe(0);
    expect((await record(a.org.id, [soft(s2, 1)])).suppressed).toBe(0);
    expect(
      (await record(a.org.id, [event(s2, { type: 'delivered', occurredAt: new Date(Date.now() + 90_000) })]))
        .recorded,
    ).toBe(1);
    expect((await rows(a.org.id, sql`id = ${s2.id}`))[0]?.delivery).toBe('delivered');
    // The delivery in between reset the count: the third soft bounce doesn't suppress yet.
    expect((await record(a.org.id, [soft(s3, 2)])).suppressed).toBe(0);
    expect((await record(a.org.id, [soft(s3, 3), soft(s3, 4)])).suppressed).toBe(1);

    const c = await buyAndMail(a, ev.id, tt.id, `complaint-${uuidv7()}@example.test`);
    await dispatchDue(a.org.id, { transports: memoryTransports().transports, appOrigin: ORIGIN });
    const cm = await ticketsOf(a.org.id, c.order.id);
    expect(await record(a.org.id, [event(cm, { type: 'complained' })])).toMatchObject({ suppressed: 1 });
    await record(a.org.id, [event(cm, { type: 'delivered' })]);
    expect((await rows(a.org.id, sql`id = ${cm.id}`))[0]?.delivery).toBe('complained');
    const [listed] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ reason: string }>(
        sql`select reason from notifications.address_suppressions where message_id = ${cm.id}`,
      ),
    );
    expect(listed?.reason).toBe('complaint');
  });

  it('an event must name one of this org’s sends: other orgs, unknown ids and wrong provider ids are ignored', async () => {
    const { ev, tt } = await publishedEvent(b, {});
    const o = await buyAndMail(b, ev.id, tt.id, `bmail-${uuidv7()}@example.test`);
    await dispatchDue(b.org.id, { transports: memoryTransports().transports, appOrigin: ORIGIN });
    const m = await ticketsOf(b.org.id, o.order.id);
    // Recorded under org A's context: B's message is invisible (RLS), so nothing happens.
    expect(await record(a.org.id, [event(m, { type: 'bounced', bounceType: 'hard' })])).toMatchObject({
      recorded: 0,
      unknown: 1,
    });
    expect(await record(b.org.id, [event({ id: uuidv7() }, { type: 'delivered' })])).toMatchObject({
      unknown: 1,
    });
    expect(
      await record(b.org.id, [
        event(m, { type: 'bounced', bounceType: 'hard', providerMessageId: 'someone-else' }),
      ]),
    ).toMatchObject({ unknown: 1, suppressed: 0 });
    expect((await ticketsOf(b.org.id, o.order.id)).delivery).toBeNull();
  });

  it('only a platform actor records delivery events; the log is append-only for app_user', async () => {
    await expect(
      executeCommand(
        recordDeliveryEventsCommand,
        { provider: 'fake', events: [event({ id: uuidv7() }, { type: 'delivered' })] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      withTenant(systemCtx(a.org.id), (tx) => tx.execute(sql`delete from notifications.message_events`)),
    ).rejects.toThrow();
  });
});

describe('member email locale', () => {
  it('member notifications render in the member’s language, looked up at send time', async () => {
    const userId = uuidv7();
    await executeCommand(addMemberCommand, { userId, role: 'owner' }, b.ctx(), ports);
    await withTenant(systemCtx(b.org.id), (tx) =>
      notifier.notifyMembers(tx, {
        kind: 'messaging.contact_replied',
        params: { name: 'Cy', eventName: 'Gala' },
        dedupeKey: `reply:${uuidv7()}`,
        href: '/messages',
      }),
    );
    const { transports, emails } = memoryTransports();
    await dispatchDue(b.org.id, {
      transports,
      appOrigin: ORIGIN,
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${id}@members.test`])),
      userLocales: async (ids) => new Map(ids.map((id) => [id, id === userId ? 'es' : null])),
    });
    const mine = emails.find((e) => e.to === `${userId}@members.test`);
    expect(mine?.html).toContain('lang="es"');
    const others = emails.filter((e) => e.to.endsWith('@members.test') && e.to !== `${userId}@members.test`);
    for (const e of others) expect(e.html).toContain('lang="en"');
    const [row] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ locale: string }>(
        sql`select locale from notifications.messages where recipient_user_id = ${userId} and status = 'sent'`,
      ),
    );
    expect(row?.locale).toBe('es');
  });
});

describe('stored email previews', () => {
  it('only their creator opens them, in their org, before they expire', async () => {
    const { id } = await executeCommand(storeEmailPreviewCommand, { html: '<h1>Hi</h1>' }, a.ctx(), ports);
    expect(await executeQuery(emailPreviewQuery, { id }, a.ctx(), ports)).toEqual({ html: '<h1>Hi</h1>' });
    await expect(
      executeQuery(emailPreviewQuery, { id }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(executeQuery(emailPreviewQuery, { id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const later = userCtx(a.ownerId, a.org.id, { now: new Date(Date.now() + 11 * 60_000) });
    await expect(executeQuery(emailPreviewQuery, { id }, later, ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // Storing again later purges the expired ones.
    await executeCommand(storeEmailPreviewCommand, { html: '<p>x</p>' }, later, ports);
    const [gone] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from notifications.email_previews where id = ${id}`,
      ),
    );
    expect(gone?.n).toBe(0);
  });

  it('refuses oversized previews and anonymous callers', async () => {
    await expect(
      executeCommand(storeEmailPreviewCommand, { html: 'x'.repeat(PREVIEW_MAX_BYTES + 1) }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(storeEmailPreviewCommand, { html: '<p>x</p>' }, createCtx({ orgId: a.org.id }), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
