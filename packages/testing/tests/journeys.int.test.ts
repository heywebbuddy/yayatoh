import { createECDH } from 'node:crypto';
import {
  createJourneyCommand,
  deleteJourneyCommand,
  journeyCancellations,
  journeyQuery,
  journeyRescheduler,
  journeyRunQuery,
  journeyRunsQuery,
  journeySubscribers,
  journeyTriggers,
  listJourneysQuery,
  type RunnerDeps,
  runDueActions,
  STEP_FAILED_EVENT,
  type StepInput,
  setJourneyEnabledCommand,
  updateJourneyCommand,
  visionTemplate,
} from '@yayatoh/automations';
import { scanTicketCommand } from '@yayatoh/checkin';
import { recordConsentTx, setContactPhoneTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand, updateEventCommand } from '@yayatoh/events';
import {
  createCtx,
  DomainError,
  executeCommand,
  executeQuery,
  utcToZonedInput,
  uuidv7,
  zonedTimeToUtc,
} from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  orderByManageToken,
  registerOrderPushCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { consumeEvent, emitEvents, type Notifier, recentEventsTx, subscribes } from '@yayatoh/platform';
import { createSurveyCommand, surveyMailer } from '@yayatoh/surveys';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M3.7a journeys on real Postgres with a fake clock: the vision journey sends exactly five
 * messages at the right offsets; a date change reschedules pending steps; retries never
 * duplicate; `replayed` events never trigger; refunds and cancellations cancel pending steps; a
 * failing step raises the failure alert; tenant isolation and permissions.
 */

const TZ = 'America/Chicago';
const ORIGIN = 'https://app.yayatoh.test';
const DAY = 86_400_000;
const notifier = createNotifier();
const deps: RunnerDeps = { notifier };
let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;

const COPY = {
  confirmation: { subject: 'You are in, {name}', body: 'See you at {event} on {when}.' },
  week: { subject: 'One week to {event}', body: 'Only seven days left.' },
  day: { subject: 'Tomorrow: {event}', body: 'Doors at seven.' },
  eventDay: { subject: 'Today: {event}', body: 'See you tonight.' },
} as const;
const vision = () => visionTemplate(COPY);

/** A wall-clock day in Chicago `days` from now. */
const localDay = (days: number) => utcToZonedInput(new Date(Date.now() + days * DAY), TZ).slice(0, 10);
const chicago = (day: string, time: string) => zonedTimeToUtc(`${day}T${time}`, TZ);
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** A published event of org `f` with a free pass, 19:00–23:00 Chicago on `day`. */
async function mkEvent(f: OrgFixture, name: string, day: string) {
  const ev = await executeCommand(
    createEventCommand,
    {
      name,
      timezone: TZ,
      startsAt: chicago(day, '19:00').toISOString(),
      endsAt: chicago(day, '23:00').toISOString(),
    },
    f.ctx(),
    ports,
  );
  const pass = await executeCommand(
    createTicketTypeCommand,
    { eventId: ev.id, name: 'Pass', priceMinor: 0, quantityTotal: 100 },
    f.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, f.ctx(), ports);
  return { eventId: ev.id, passId: pass.id, day };
}

/** A guest takes one free pass (paid at once: `order.paid@1`). */
async function buy(f: OrgFixture, ev: { eventId: string; passId: string }, who: string) {
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: ev.eventId,
      items: [{ ticketTypeId: ev.passId, quantity: 1 }],
      buyer: { email: `${who}@example.test`, name: who },
    },
    createCtx({ orgId: f.org.id }),
    ports,
  );
  const order = await orderByManageToken(r.manageToken);
  return { orderId: r.order.id, manageToken: r.manageToken, tickets: order?.tickets ?? [] };
}

/** A guest buys one paid pass through the fake provider (`order.paid@1` once the payment succeeds). */
async function buyPaid(f: OrgFixture, ev: { eventId: string; passId: string }, who: string) {
  const anon = createCtx({ orgId: f.org.id });
  const r = await executeCommand(
    startCheckoutCommand,
    {
      eventId: ev.eventId,
      items: [{ ticketTypeId: ev.passId, quantity: 1 }],
      buyer: { email: `${who}@example.test`, name: who },
    },
    anon,
    ports,
  );
  const pi = `fakepi_${uuidv7()}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: 'fake', providerPaymentId: pi },
    anon,
    ports,
  );
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${uuidv7()}`,
      type: 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: r.order.totalMinor,
      currency: r.order.currency,
      orgId: f.org.id,
      orderId: r.order.id,
    },
    systemCtx(f.org.id),
    ports,
  );
  const order = await orderByManageToken(r.manageToken);
  return { orderId: r.order.id, tickets: order?.tickets ?? [] };
}

/** The org's recent outbox events through the journey subscribers and the survey mailer. */
async function relay(orgId = a.org.id) {
  const subs = [...journeySubscribers(), surveyMailer({ notifier, appOrigin: ORIGIN })];
  const types = [...new Set(subs.flatMap((s) => s.events.map((e) => e.split('@')[0] as string)))];
  const events = await withTenant(systemCtx(orgId), (tx) => recentEventsTx(tx, orgId, types, 3_600_000));
  for (const e of events) for (const s of subs) if (subscribes(s, e)) await consumeEvent(s, e);
}

async function journey(f: OrgFixture, input: Record<string, unknown>, enabled = true) {
  const { id } = await executeCommand(createJourneyCommand, input, f.ctx(), ports);
  if (enabled)
    await executeCommand(setJourneyEnabledCommand, { journeyId: id, enabled: true }, f.ctx(), ports);
  return id;
}

const run = (now: Date, orgId = a.org.id, d: RunnerDeps = deps) => runDueActions(orgId, d, ports, { now });

const contactOf = async (email: string, orgId = a.org.id) =>
  (
    await admin<
      { id: string }[]
    >`select id from crm.contacts where org_id = ${orgId} and email_norm = ${email}`
  )[0]?.id as string;

const actionsOf = (journeyId: string, contactId: string) =>
  admin<
    {
      position: number;
      action: string;
      status: string;
      outcome: string | null;
      scheduled_for: Date;
      due_at: Date;
      attempts: number;
      idempotency_key: string;
    }[]
  >`select position, action, status, outcome, scheduled_for, due_at, attempts, idempotency_key
    from automations.scheduled_actions where journey_id = ${journeyId} and contact_id = ${contactId}
    order by position`;

const messagesOf = (contactId: string) =>
  admin<{ kind: string; channel: string; status: string; sent_at: Date | null; dedupe_key: string }[]>`
    select kind, channel, status, sent_at, dedupe_key from notifications.messages
    where contact_id = ${contactId} order by created_at, channel`;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
});
afterAll(async () => {
  await admin?.end();
  await closePools();
});

describe('the vision journey with a fake clock (M3.7a)', () => {
  it('sends exactly five messages at the right offsets: confirmation, T−7 d, T−24 h text, event-day push, survey', async () => {
    const day = localDay(12);
    const ev = await mkEvent(a, 'Vision Night', day);
    await executeCommand(
      createSurveyCommand,
      {
        eventId: ev.eventId,
        kind: 'post_event',
        title: 'How was Vision Night?',
        definition: { fields: [{ key: 'nps', type: 'nps', label: 'Recommend us?', required: true }] },
      },
      a.ctx(),
      ports,
    );
    const t = vision();
    const journeyId = await journey(a, { name: 'Vision', eventId: ev.eventId, template: 'vision', ...t });
    const bought = await buy(a, ev, 'vera.vision');
    const contactId = await contactOf('vera.vision@example.test');
    // The buyer gave a phone with consent to informational texts, and opted a browser into push.
    await withTenant(systemCtx(a.org.id), async (tx) => {
      await setContactPhoneTx(tx, systemCtx(a.org.id), contactId, '+13125550142');
      await recordConsentTx(tx, systemCtx(a.org.id), {
        contactId,
        channel: 'sms',
        purpose: 'informational',
        status: 'granted',
        evidence: 'fixture: checkout checkbox',
      });
    });
    const key = createECDH('prime256v1');
    key.generateKeys();
    const endpoint = `https://fcm.googleapis.com/fcm/send/journey-${uuidv7()}`;
    await executeCommand(
      registerOrderPushCommand,
      {
        token: bought.manageToken,
        subscription: {
          endpoint,
          keys: {
            p256dh: key.getPublicKey().toString('base64url'),
            auth: Buffer.alloc(16, 3).toString('base64url'),
          },
        },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    await relay();
    const planned = await actionsOf(journeyId, contactId);
    expect(planned.map((p) => [p.action, p.status])).toEqual([
      ['email', 'pending'],
      ['email', 'pending'],
      ['sms', 'pending'],
      ['push', 'pending'],
      ['survey', 'pending'],
    ]);
    const expected = [
      planned[0]?.scheduled_for as Date, // the purchase
      chicago(plusDays(day, -7), '19:00'),
      chicago(plusDays(day, -1), '19:00'),
      chicago(day, '09:00'),
      chicago(plusDays(day, 1), '10:00'),
    ];
    expect(planned.slice(1).map((p) => p.scheduled_for.toISOString())).toEqual(
      expected.slice(1).map((d) => d.toISOString()),
    );

    const mem = memoryTransports();
    // Only Vera's deliveries count (the org's other queued messages go out in the same ticks).
    const mine = () => ({
      emails: mem.emails.filter((m) => m.to === 'vera.vision@example.test'),
      sms: mem.sms.filter((m) => m.to === '+13125550142'),
      pushes: mem.pushes.filter((m) => m.token === endpoint),
      whatsapp: mem.whatsapp.filter((m) => m.to === '+13125550142'),
    });
    const total = () => Object.values(mine()).reduce((n, list) => n + list.length, 0);
    const tick = async (now: Date) => {
      await run(now);
      await relay();
      for (let i = 0; i < 3; i++)
        await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: () => now });
    };
    // The confirmation at the purchase (dispatched at the next noon in Chicago: quiet hours apply).
    const noon = chicago(localDay(1), '12:00');
    await tick(noon);
    expect(mine().emails.map((m) => m.subject)).toEqual(['You are in, vera.vision']);
    // Nothing a minute before each step; the step exactly at its time.
    const steps: [Date, () => number][] = [
      [expected[1] as Date, () => mine().emails.length],
      [expected[2] as Date, () => mine().sms.length],
      [expected[3] as Date, () => mine().pushes.length],
      [expected[4] as Date, () => mine().emails.length],
    ];
    for (const [at, count] of steps) {
      const before = total();
      const had = count();
      await tick(new Date(at.getTime() - 60_000));
      expect(total()).toBe(before);
      await tick(at);
      expect(count()).toBe(had + 1);
      expect(total()).toBe(before + 1);
    }
    expect(mine().emails.map((m) => m.subject)).toEqual([
      'You are in, vera.vision',
      'One week to Vision Night',
      'How was Vision Night?',
    ]);
    expect(mine().pushes.map((m) => m.title)).toEqual(['Today: Vision Night']);
    expect(mine().emails[0]?.text).toContain('See you at Vision Night on');
    expect(mine().sms[0]?.body).toContain('Tomorrow: Vision Night');
    // Long after: still exactly five.
    await tick(new Date(Date.now() + 60 * DAY));
    expect(total()).toBe(5);
    const sent = (await messagesOf(contactId)).filter((m) => m.status === 'sent');
    expect(sent).toHaveLength(5);
    expect(sent.map((m) => m.sent_at?.toISOString()).sort()).toEqual(
      [noon, ...expected.slice(1)].map((d) => d.toISOString()).sort(),
    );
    const after = await actionsOf(journeyId, contactId);
    expect(after.map((p) => [p.status, p.outcome])).toEqual([
      ['done', 'queued'],
      ['done', 'queued'],
      ['done', 'queued'],
      ['done', 'queued'],
      ['done', 'invited'],
    ]);
    // Run history: per journey and per person.
    const runs = await executeQuery(journeyRunsQuery, { journeyId }, a.ctx(), ports);
    expect(runs.rows).toMatchObject([
      { email: 'vera.vision@example.test', status: 'completed', counts: { done: 5 } },
    ]);
    const detail = await executeQuery(
      journeyRunQuery,
      { journeyId, runId: runs.rows[0]?.id as string },
      a.ctx(),
      ports,
    );
    expect(detail.actions.map((x) => x.action)).toEqual(['email', 'email', 'sms', 'push', 'survey']);
    const summary = await executeQuery(journeyQuery, { journeyId }, a.ctx(), ports);
    expect(summary).toMatchObject({ enabled: true, runs: 1, actions: { done: 5, pending: 0 } });
    expect(JSON.stringify(summary)).not.toContain('idempotency');
  });

  it('a buyer three days before the event skips the steps whose time has passed', async () => {
    const ev = await mkEvent(a, 'Late Buyers', localDay(3));
    const journeyId = await journey(a, { name: 'Late', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'lou.late');
    await relay();
    const rows = await actionsOf(journeyId, await contactOf('lou.late@example.test'));
    expect(rows.map((r) => [r.action, r.status, r.outcome])).toEqual([
      ['email', 'pending', null],
      ['email', 'skipped', 'too_late'],
      ['sms', 'pending', null],
      ['push', 'pending', null],
      ['survey', 'pending', null],
    ]);
  });
});

describe('reschedule on date change', () => {
  it('pending steps move with the event (same wall-clock time); steps that ran never run again', async () => {
    const day = localDay(20);
    const ev = await mkEvent(a, 'Moving Show', day);
    const journeyId = await journey(a, { name: 'Moves', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'mo.mover');
    await relay();
    const contactId = await contactOf('mo.mover@example.test');
    await run(new Date(Date.now() + 60_000)); // the confirmation runs
    const newDay = plusDays(day, 3);
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.eventId,
        startsAt: chicago(newDay, '19:00').toISOString(),
        endsAt: chicago(newDay, '23:00').toISOString(),
      },
      a.ctx(),
      ports,
    );
    await relay();
    const rows = await actionsOf(journeyId, contactId);
    expect(rows.map((r) => [r.status, r.scheduled_for.toISOString()])).toEqual([
      ['done', rows[0]?.scheduled_for.toISOString()],
      ['pending', chicago(plusDays(newDay, -7), '19:00').toISOString()],
      ['pending', chicago(plusDays(newDay, -1), '19:00').toISOString()],
      ['pending', chicago(newDay, '09:00').toISOString()],
      ['pending', chicago(plusDays(newDay, 1), '10:00').toISOString()],
    ]);
    // Replaying the change (or running the rescheduler again) changes nothing.
    const again = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['event.updated'], 3_600_000),
    );
    for (const e of again.filter((x) => (x.payload as { eventId: string }).eventId === ev.eventId))
      await withTenant(systemCtx(a.org.id), (tx) => journeyRescheduler().handle(tx, e));
    expect((await actionsOf(journeyId, contactId)).map((r) => r.scheduled_for.toISOString())).toEqual(
      rows.map((r) => r.scheduled_for.toISOString()),
    );
    // The confirmation's key is spent: running everything later sends one confirmation, ever.
    await run(chicago(plusDays(newDay, 2), '12:00'));
    const confirmations = (await messagesOf(contactId)).filter(
      (m) => m.dedupe_key === rows[0]?.idempotency_key,
    );
    expect(confirmations).toHaveLength(1);
  });

  it('moving the event closer runs an overdue step now; postponing parks steps until it is rescheduled', async () => {
    const day = localDay(25);
    const ev = await mkEvent(a, 'Closer Show', day);
    const journeyId = await journey(a, { name: 'Closer', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'cy.closer');
    await relay();
    const contactId = await contactOf('cy.closer@example.test');
    const soon = localDay(4);
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.eventId,
        startsAt: chicago(soon, '19:00').toISOString(),
        endsAt: chicago(soon, '23:00').toISOString(),
      },
      a.ctx(),
      ports,
    );
    await relay();
    const week = (await actionsOf(journeyId, contactId))[1];
    // Its new time (T−7 d) has passed but the event is still ahead: due now.
    expect(week?.status).toBe('pending');
    expect(Math.abs((week?.scheduled_for.getTime() ?? 0) - Date.now())).toBeLessThan(120_000);

    await executeCommand(
      transitionEventCommand,
      { eventId: ev.eventId, transition: 'postpone' },
      a.ctx(),
      ports,
    );
    await relay();
    const parked = await actionsOf(journeyId, contactId);
    expect(parked.slice(2).map((r) => [r.status, r.outcome])).toEqual([
      ['cancelled', 'event_postponed'],
      ['cancelled', 'event_postponed'],
      ['cancelled', 'event_postponed'],
    ]);
    const later = localDay(40);
    await executeCommand(
      updateEventCommand,
      {
        eventId: ev.eventId,
        startsAt: chicago(later, '19:00').toISOString(),
        endsAt: chicago(later, '23:00').toISOString(),
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      transitionEventCommand,
      { eventId: ev.eventId, transition: 'reschedule' },
      a.ctx(),
      ports,
    );
    await relay();
    const back = await actionsOf(journeyId, contactId);
    expect(back.slice(2).map((r) => [r.status, r.scheduled_for.toISOString()])).toEqual([
      ['pending', chicago(plusDays(later, -1), '19:00').toISOString()],
      ['pending', chicago(later, '09:00').toISOString()],
      ['pending', chicago(plusDays(later, 1), '10:00').toISOString()],
    ]);
  });
});

describe('exactly once', () => {
  it('a doubled event, two runners at once and a step forced back to pending never duplicate a send', async () => {
    const ev = await mkEvent(a, 'Once Only', localDay(15));
    const journeyId = await journey(a, { name: 'Once', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'olly.once');
    await relay();
    // The same order.paid handed over again (a redelivered job, a direct second call): one run.
    const paid = (
      await withTenant(systemCtx(a.org.id), (tx) => recentEventsTx(tx, a.org.id, ['order.paid'], 3_600_000))
    ).filter((e) => (e.payload as { eventId?: string }).eventId === ev.eventId);
    for (const e of paid) {
      expect(await consumeEvent(journeyTriggers(), e)).toBe(false);
      await withTenant(systemCtx(a.org.id), (tx) => journeyTriggers().handle(tx, e));
    }
    const contactId = await contactOf('olly.once@example.test');
    expect(
      await admin`select id from automations.journey_runs where journey_id = ${journeyId} and contact_id = ${contactId}`,
    ).toHaveLength(1);
    // Two runners at the same moment.
    const now = new Date(Date.now() + 60_000);
    const [r1, r2] = await Promise.all([run(now), run(now)]);
    expect((r1?.done ?? 0) + (r2?.done ?? 0)).toBeGreaterThanOrEqual(1);
    const key = (await actionsOf(journeyId, contactId))[0]?.idempotency_key as string;
    const byKey = async () => (await messagesOf(contactId)).filter((m) => m.dedupe_key === key);
    expect(await byKey()).toHaveLength(1);
    expect((await actionsOf(journeyId, contactId))[0]).toMatchObject({ status: 'done', attempts: 1 });
    // A lost update puts the row back to pending: the message key still holds.
    await admin`update automations.scheduled_actions set status = 'pending', completed_at = null
      where idempotency_key = ${key}`;
    await run(new Date(Date.now() + 120_000));
    expect((await actionsOf(journeyId, contactId))[0]).toMatchObject({
      status: 'done',
      outcome: 'already_queued',
    });
    expect(await byKey()).toHaveLength(1);
  });

  it('a failed attempt leaves nothing behind and the retry sends once', async () => {
    const ev = await mkEvent(a, 'Retry Hall', localDay(15));
    const journeyId = await journey(a, { name: 'Retry', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'rita.retry');
    await relay();
    const contactId = await contactOf('rita.retry@example.test');
    // The message is queued, then the transaction dies before it commits.
    const flaky: Notifier = {
      async enqueue(tx, intent) {
        await notifier.enqueue(tx, intent);
        throw new Error('connection reset');
      },
      notifyMembers: notifier.notifyMembers,
    };
    const t0 = new Date(Date.now() + 60_000);
    expect(await run(t0, a.org.id, { notifier: flaky })).toMatchObject({ retried: 1, done: 0 });
    const [first] = await actionsOf(journeyId, contactId);
    expect(first).toMatchObject({ status: 'pending', attempts: 1 });
    expect(first?.due_at.getTime()).toBe(t0.getTime() + 60_000);
    expect(await messagesOf(contactId)).toHaveLength(0);
    // Not due again until the backoff has passed.
    expect(await run(new Date(t0.getTime() + 30_000))).toMatchObject({ done: 0, retried: 0 });
    expect(await run(new Date(t0.getTime() + 61_000))).toMatchObject({ done: 1 });
    expect(await messagesOf(contactId)).toHaveLength(1);
    expect((await actionsOf(journeyId, contactId))[0]).toMatchObject({ status: 'done', attempts: 2 });
  });
});

describe('replayed events never trigger journeys', () => {
  it('a backfilled order.paid (legacy migration) enrolls nobody; replayed cancellations cancel nothing', async () => {
    const ev = await mkEvent(a, 'History Hall', localDay(15));
    const journeyId = await journey(a, { name: 'History', eventId: ev.eventId, ...vision() });
    const { orderId } = await buy(a, ev, 'hal.history');
    // Only a replayed copy of the order's event is handed over (the live one is not relayed).
    const ctx = systemCtx(a.org.id);
    await withTenant(ctx, (tx) =>
      emitEvents(
        tx,
        ctx,
        [
          {
            type: 'order.paid',
            version: 1,
            aggregateType: 'order',
            aggregateId: orderId,
            payload: { orgId: a.org.id, orderId, eventId: ev.eventId },
          },
          {
            type: 'event.cancelled',
            version: 1,
            aggregateType: 'event',
            aggregateId: ev.eventId,
            payload: { orgId: a.org.id, eventId: ev.eventId },
          },
        ],
        { replayed: true },
      ),
    );
    const replayed = (
      await withTenant(ctx, (tx) =>
        recentEventsTx(tx, a.org.id, ['order.paid', 'event.cancelled'], 3_600_000),
      )
    ).filter((e) => e.replayed && e.aggregateId === orderId);
    expect(replayed).toHaveLength(1);
    for (const e of replayed) {
      expect(await consumeEvent(journeyTriggers(), e)).toBe(false);
      // Even called directly with the flag, the handler does nothing.
      await withTenant(ctx, (tx) => journeyTriggers().handle(tx, e));
    }
    expect(await admin`select id from automations.journey_runs where journey_id = ${journeyId}`).toHaveLength(
      0,
    );
    // The live event enrolls; a replayed cancellation of the event then cancels nothing.
    await relay();
    const cancelled = (
      await withTenant(ctx, (tx) => recentEventsTx(tx, a.org.id, ['event.cancelled'], 3_600_000))
    ).filter((e) => e.replayed && e.aggregateId === ev.eventId);
    for (const e of cancelled) expect(await consumeEvent(journeyCancellations(), e)).toBe(false);
    expect(await admin`select status from automations.journey_runs where journey_id = ${journeyId}`).toEqual([
      { status: 'active' },
    ]);
  });
});

describe('cancellation hooks', () => {
  it('a full refund cancels the pending steps its order started; what ran stays', async () => {
    const ev = await mkEvent(a, 'Refund Room', localDay(15));
    const paid = await executeCommand(
      createTicketTypeCommand,
      { eventId: ev.eventId, name: 'Paid', priceMinor: 1500, quantityTotal: 10 },
      a.ctx(),
      ports,
    );
    const journeyId = await journey(a, { name: 'Refunds', eventId: ev.eventId, ...vision() });
    const { orderId, tickets } = await buyPaid(a, { eventId: ev.eventId, passId: paid.id }, 'rae.refund');
    await relay();
    await run(new Date(Date.now() + 60_000));
    const contactId = await contactOf('rae.refund@example.test');
    const r = await executeCommand(
      startRefundCommand,
      { orderId, reason: 'requested_by_customer', ticketIds: tickets.map((t) => t.id) },
      a.ctx(),
      ports,
    );
    await executeCommand(
      completeRefundCommand,
      { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${uuidv7()}` },
      a.ctx(),
      ports,
    );
    await relay();
    const rows = await actionsOf(journeyId, contactId);
    expect(rows[0]).toMatchObject({ status: 'done' });
    expect(rows.slice(1).map((x) => [x.status, x.outcome])).toEqual(
      Array.from({ length: 4 }, () => ['cancelled', 'order_refunded']),
    );
    expect(
      await admin`select status, reason from automations.journey_runs where journey_id = ${journeyId}`,
    ).toEqual([{ status: 'cancelled', reason: 'order_refunded' }]);
    // Nothing more is ever sent for it.
    await run(new Date(Date.now() + 30 * DAY));
    expect((await messagesOf(contactId)).filter((m) => m.kind === 'automations.message')).toHaveLength(1);
  });

  it('cancelling the event cancels every pending step of every run for it', async () => {
    const ev = await mkEvent(a, 'Called Off', localDay(15));
    const journeyId = await journey(a, { name: 'Off', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'cal.one');
    await buy(a, ev, 'cal.two');
    await relay();
    await executeCommand(
      transitionEventCommand,
      { eventId: ev.eventId, transition: 'cancel' },
      a.ctx(),
      ports,
    );
    await relay();
    expect(
      await admin`select distinct status, reason from automations.journey_runs where journey_id = ${journeyId}`,
    ).toEqual([{ status: 'cancelled', reason: 'event_cancelled' }]);
    expect(
      await admin`select count(*)::int as n from automations.scheduled_actions where journey_id = ${journeyId} and status = 'pending'`,
    ).toEqual([{ n: 0 }]);
  });
});

describe('failures', () => {
  it('a step that keeps failing is marked failed after five attempts and raises the alert event', async () => {
    const ev = await mkEvent(a, 'Broken Pipe', localDay(15));
    const journeyId = await journey(a, { name: 'Broken', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'bo.broken');
    await relay();
    const contactId = await contactOf('bo.broken@example.test');
    const broken: Notifier = {
      async enqueue() {
        throw new Error('provider down');
      },
      notifyMembers: notifier.notifyMembers,
    };
    let t = new Date(Date.now() + 60_000);
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await run(t, a.org.id, { notifier: broken }));
      t = new Date(t.getTime() + 2 * 3_600_000);
    }
    expect(results.map((r) => [r.retried, r.failed])).toEqual([
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    const [step] = await actionsOf(journeyId, contactId);
    expect(step).toMatchObject({ status: 'failed', attempts: 5, outcome: 'error' });
    const [alert] = await admin<{ payload: Record<string, unknown>; version: number }[]>`
      select payload, version from platform.domain_events
      where org_id = ${a.org.id} and type = ${STEP_FAILED_EVENT} and payload->>'journeyId' = ${journeyId}`;
    expect(alert).toMatchObject({
      version: 1,
      payload: { orgId: a.org.id, journeyId, position: 0, action: 'email', attempts: 5, error: 'error' },
    });
    // The other steps still run.
    expect((await actionsOf(journeyId, contactId)).slice(1).every((x) => x.status === 'pending')).toBe(true);
  });

  it('a permanent error fails the step at once', async () => {
    const ev = await mkEvent(a, 'Bad Data', localDay(15));
    const journeyId = await journey(a, { name: 'Bad', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'bea.bad');
    await relay();
    const invalid: Notifier = {
      async enqueue() {
        throw new DomainError('validation_failed', 'bad template');
      },
      notifyMembers: notifier.notifyMembers,
    };
    expect(await run(new Date(Date.now() + 60_000), a.org.id, { notifier: invalid })).toMatchObject({
      failed: 1,
    });
    expect((await actionsOf(journeyId, await contactOf('bea.bad@example.test')))[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
    });
  });
});

describe('triggers, conditions and actions', () => {
  it('check-in enrolls the holder; a label step and conditions checked when due', async () => {
    const day = localDay(2);
    const ev = await mkEvent(a, 'Door Night', day);
    const steps: StepInput[] = [
      { anchor: 'trigger', action: 'label', label: 'Came in' },
      {
        anchor: 'trigger',
        offsetMinutes: 30,
        action: 'email',
        subject: 'Thanks',
        body: 'For coming.',
        condition: 'checked_in',
      },
      {
        anchor: 'trigger',
        offsetMinutes: 30,
        action: 'email',
        subject: 'Seat',
        body: 'Your seat.',
        condition: 'has_seat',
      },
      {
        anchor: 'event_end',
        offsetMinutes: 60,
        action: 'email',
        subject: 'Survey?',
        body: 'Tell us.',
        condition: 'not_answered_survey',
      },
    ];
    const journeyId = await journey(a, {
      name: 'At the door',
      eventId: ev.eventId,
      trigger: 'checked_in',
      steps,
    });
    const { tickets } = await buy(a, ev, 'dora.door');
    await relay();
    const contactId = await contactOf('dora.door@example.test');
    expect(await actionsOf(journeyId, contactId)).toHaveLength(0); // bought, not yet in
    const during = new Date(chicago(day, '19:30'));
    await executeCommand(
      scanTicketCommand,
      { eventId: ev.eventId, code: tickets[0]?.code as string },
      a.ctx({ now: during }),
      ports,
    );
    await relay();
    const planned = await actionsOf(journeyId, contactId);
    expect(planned.map((p) => p.status)).toEqual(['pending', 'pending', 'pending', 'pending']);
    await run(new Date(Math.max(Date.now(), during.getTime()) + 31 * 60_000));
    await run(new Date(chicago(day, '23:00').getTime() + 61 * 60_000));
    expect((await actionsOf(journeyId, contactId)).map((p) => [p.status, p.outcome])).toEqual([
      ['done', 'label_added'],
      ['done', 'queued'],
      ['skipped', 'condition_not_met'],
      ['done', 'queued'],
    ]);
    const [label] = await admin<{ labels: string[] }[]>`
      select labels from attendees.attendees where event_id = ${ev.eventId} and contact_id = ${contactId}`;
    expect(label?.labels).toContain('Came in');
  });

  it('a person without a phone or device skips text and push steps; a second purchase never enrolls twice', async () => {
    const ev = await mkEvent(a, 'Quiet Room', localDay(15));
    const journeyId = await journey(a, { name: 'Quiet', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'nia.nophone');
    await buy(a, ev, 'nia.nophone');
    await relay();
    const contactId = await contactOf('nia.nophone@example.test');
    expect(await actionsOf(journeyId, contactId)).toHaveLength(5);
    await run(new Date(Date.now() + 40 * DAY));
    expect((await actionsOf(journeyId, contactId)).map((p) => [p.action, p.outcome])).toEqual([
      ['email', 'queued'],
      ['email', 'queued'],
      ['sms', 'no_phone'],
      ['push', 'no_device'],
      ['survey', 'no_survey'],
    ]);
  });
});

describe('building journeys', () => {
  it('validates, edits only while off, keeps step ids, and switching off cancels pending steps', async () => {
    const ev = await mkEvent(a, 'Builder Hall', localDay(15));
    await expect(
      executeCommand(
        createJourneyCommand,
        { name: ' ', eventId: ev.eventId, trigger: 'order_paid' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(createJourneyCommand, { name: 'Both', trigger: 'order_paid' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        createJourneyCommand,
        {
          name: 'Timed',
          eventId: ev.eventId,
          trigger: 'event_time',
          steps: [{ anchor: 'trigger', action: 'survey' }],
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'anchor_needs_trigger' } });
    const id = await journey(a, { name: 'Empty', eventId: ev.eventId, trigger: 'order_paid' }, false);
    await expect(
      executeCommand(setJourneyEnabledCommand, { journeyId: id, enabled: true }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'no_steps' } });
    const t = vision();
    await executeCommand(
      updateJourneyCommand,
      { journeyId: id, name: 'Full', trigger: t.trigger, steps: t.steps },
      a.ctx(),
      ports,
    );
    const before = await executeQuery(journeyQuery, { journeyId: id }, a.ctx(), ports);
    expect(before.steps.map((s) => s.action)).toEqual(['email', 'email', 'sms', 'push', 'survey']);
    // Reorder (last two swapped) and drop the SMS: kept steps keep their ids.
    const [s0, s1, , s3, s4] = before.steps;
    await executeCommand(
      updateJourneyCommand,
      {
        journeyId: id,
        name: 'Full',
        trigger: 'order_paid',
        steps: [s0, s1, s4, { ...s3, action: 'whatsapp' }],
      },
      a.ctx(),
      ports,
    );
    const after = await executeQuery(journeyQuery, { journeyId: id }, a.ctx(), ports);
    expect(after.steps.map((s) => [s.id, s.position, s.action])).toEqual([
      [s0?.id, 0, 'email'],
      [s1?.id, 1, 'email'],
      [s4?.id, 2, 'survey'],
      [s3?.id, 3, 'whatsapp'],
    ]);
    await executeCommand(setJourneyEnabledCommand, { journeyId: id, enabled: true }, a.ctx(), ports);
    await expect(
      executeCommand(
        updateJourneyCommand,
        { journeyId: id, name: 'Nope', trigger: 'order_paid', steps: [] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'journey_enabled' } });
    await buy(a, ev, 'ed.editor');
    await relay();
    const off = await executeCommand(
      setJourneyEnabledCommand,
      { journeyId: id, enabled: false },
      a.ctx(),
      ports,
    );
    expect(off).toEqual({ enabled: false, cancelled: 4 });
    // Switched off: nobody new enters.
    await buy(a, ev, 'late.editor');
    await relay();
    expect(await admin`select id from automations.journey_runs where journey_id = ${id}`).toHaveLength(1);
    await expect(
      executeCommand(deleteJourneyCommand, { journeyId: id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'has_runs' } });
    const spare = await journey(a, { name: 'Spare', eventId: ev.eventId, trigger: 'order_paid' }, false);
    await executeCommand(deleteJourneyCommand, { journeyId: spare }, a.ctx(), ports);
    expect((await executeQuery(listJourneysQuery, {}, a.ctx(), ports)).some((j) => j.id === spare)).toBe(
      false,
    );
  });

  it('event_time journeys enroll everyone on the list, and people added later on the next pass', async () => {
    const ev = await mkEvent(a, 'Timed Gala', localDay(15));
    await buy(a, ev, 'tim.one');
    const id = await journey(a, {
      name: 'Timed',
      eventId: ev.eventId,
      trigger: 'event_time',
      steps: [{ anchor: 'event_start', offsetDays: -1, action: 'email', subject: 'Tomorrow', body: 'Hi' }],
    });
    expect(await run(new Date())).toMatchObject({ enrolled: 1 });
    await buy(a, ev, 'tim.two');
    expect(await run(new Date())).toMatchObject({ enrolled: 1 });
    expect(await run(new Date())).toMatchObject({ enrolled: 0 });
    expect(await admin`select id from automations.journey_runs where journey_id = ${id}`).toHaveLength(2);
  });
});

describe('permissions and isolation', () => {
  it('viewers read but never write; another org sees nothing and its runner touches nothing', async () => {
    const ev = await mkEvent(a, 'Private Journey', localDay(15));
    const id = await journey(a, { name: 'Secret', eventId: ev.eventId, ...vision() });
    await buy(a, ev, 'iso.person');
    await relay();
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(journeyQuery, { journeyId: id }, viewer, ports)).name).toBe('Secret');
    await expect(
      executeCommand(setJourneyEnabledCommand, { journeyId: id, enabled: false }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(createJourneyCommand, { name: 'X', eventId: ev.eventId, ...vision() }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Org b: not found, not listed, can't build on a's event, and its runner leaves a's steps alone.
    await expect(executeQuery(journeyQuery, { journeyId: id }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await executeQuery(listJourneysQuery, {}, b.ctx(), ports)).some((j) => j.id === id)).toBe(false);
    await expect(
      executeCommand(
        createJourneyCommand,
        { name: 'Steal', eventId: ev.eventId, ...vision() },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(setJourneyEnabledCommand, { journeyId: id, enabled: false }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    const pending = async () =>
      (
        await admin<{ n: number }[]>`select count(*)::int as n from automations.scheduled_actions
        where journey_id = ${id} and status = 'pending'`
      )[0]?.n;
    const n = await pending();
    await run(new Date(Date.now() + 60 * DAY), b.org.id);
    expect(await pending()).toBe(n);
    // Users can't run steps themselves (system actors only).
    await expect(
      executeCommand(
        (await import('@yayatoh/automations')).runScheduledActionCommand(deps),
        { actionId: uuidv7() },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
