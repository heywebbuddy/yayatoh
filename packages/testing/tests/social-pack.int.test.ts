import { type AlertDto, catchUpAlerts, listAlertsQuery } from '@yayatoh/alerts';
import {
  type AnyWidgetDef,
  arrivalsWidget,
  guestSeatingWidget,
  mealsWidget,
  rsvpWidget,
  type WidgetDef,
} from '@yayatoh/command-center';
import { closePools } from '@yayatoh/db/testing';
import { assignEventRoleCommand, createEventCommand } from '@yayatoh/events';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, renderMessage } from '@yayatoh/notifications';
import { addMemberCommand } from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type OrgFixture,
  ports,
  SOCIAL_FIXTURE,
  type SocialPackScenario,
  socialPackScenario,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M4.6a social Command Center pack: the acceptance ("42 guests have not responded to RSVP",
 * clearing as they answer), the deadline −7 d / −1 d levels, guests without a table and missing
 * meals in the last week, the four widgets' numbers and allowlists, who may see them, and tenant
 * isolation.
 */

const DAY = 86_400_000;
const PACK: AnyWidgetDef[] = [rsvpWidget, guestSeatingWidget, mealsWidget, arrivalsWidget];
let a: OrgFixture;
let b: OrgFixture;
let s: SocialPackScenario;
const deps = { notifier: createNotifier() };
const members: Record<string, string> = {};
const as = (role: string) => userCtx(members[role] as string, a.org.id);

const alertsOf = (ctx: Ctx, eventId: string, status: 'active' | 'resolved' = 'active') =>
  executeQuery(listAlertsQuery, { eventId, status }, ctx, ports);
const rule = async (r: string, ctx = a.ctx(), eventId = s.eventId) =>
  (await alertsOf(ctx, eventId)).find((x) => x.rule === r);
/** The English title the console and the email use (the notifications templates). */
const title = (x: Pick<AlertDto, 'rule' | 'count'>) =>
  renderMessage({
    kind: 'alerts.alert',
    locale: 'en',
    params: { rule: x.rule, count: x.count, severity: 'warning', eventName: 'E' },
    org: { name: 'Org', brandColor: null, poweredByVisible: false },
  }).subject;
const load = <O>(w: WidgetDef<O>, ctx = a.ctx(), eventId = s.eventId) =>
  executeQuery(w.loader, { eventId }, ctx, ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  for (const role of ['finance', 'marketing', 'manager', 'viewer'] as const) {
    members[role] = uuidv7();
    await executeCommand(addMemberCommand, { userId: members[role], role }, a.ctx(), ports);
  }
  s = await socialPackScenario(a.org.id, { ctx: a.ctx(), deps });
  // Door staff at the wedding (an event role): the door layout.
  members.door = uuidv7();
  await executeCommand(addMemberCommand, { userId: members.door, role: 'viewer' }, a.ctx(), ports);
  await executeCommand(
    assignEventRoleCommand,
    { eventId: s.eventId, userId: members.door, role: 'door_staff' },
    a.ctx(),
    ports,
  );
}, 240_000);

afterAll(async () => {
  await closePools();
});

describe('the acceptance fixture (M4.6a)', () => {
  it('gives exactly "42 guests have not responded to RSVP" (warning: the deadline is 5 days away)', async () => {
    const list = await alertsOf(a.ctx(), s.eventId);
    // 40 days out: no seating or meal alert yet, only the RSVP chase.
    expect(list.map((x) => x.rule)).toEqual(['rsvpPending']);
    const [x] = list;
    expect(x).toMatchObject({ count: 42, severity: 'warning', fixPath: `/e/${s.eventSlug}/guests/rsvp` });
    expect(x?.params).toEqual({ count: 42, parties: 14, days: 5 });
    expect(title(x as AlertDto)).toBe('42 guests have not responded to RSVP');
  });

  it('the RSVP widget says the same, with the rest of the picture', async () => {
    const w = await load(rsvpWidget);
    expect(w).toMatchObject({
      timeZone: 'America/Chicago',
      invited: SOCIAL_FIXTURE.invited,
      pending: SOCIAL_FIXTURE.pending,
      pendingParties: SOCIAL_FIXTURE.pendingParties,
      responded: SOCIAL_FIXTURE.responded,
      notSent: SOCIAL_FIXTURE.notSent,
      attending: SOCIAL_FIXTURE.attending,
      deadline: s.deadline.toISOString(),
    });
    expect(Object.keys(w).sort()).toEqual(
      [
        'asOf',
        'attending',
        'deadline',
        'invited',
        'notSent',
        'pending',
        'pendingParties',
        'responded',
        'timeZone',
      ].sort(),
    );
  });
});

describe('levels: deadline −7 d and −1 d', () => {
  it('nothing more than 7 days before the deadline; the sweep raises it at −7 d (event beyond 30 days)', async () => {
    const far = await socialPackScenario(a.org.id, { ctx: a.ctx(), deps, deadlineInDays: 10 });
    expect(await rule('rsvpPending', a.ctx(), far.eventId)).toBeUndefined();
    await far.evaluate(new Date(Date.now() + 3 * DAY + 60_000));
    expect(await rule('rsvpPending', a.ctx(), far.eventId)).toMatchObject({ count: 42, severity: 'warning' });
    // In the last day it becomes critical (and is sent again: escalation).
    await far.evaluate(new Date(far.deadline.getTime() - 12 * 3_600_000));
    const critical = await rule('rsvpPending', a.ctx(), far.eventId);
    expect(critical).toMatchObject({ count: 42, severity: 'critical' });
    expect(critical?.params.days).toBe(1);
  });

  it('in the last week before the wedding: guests without a table and missing meals', async () => {
    const start = s.startsAt.getTime();
    await s.evaluate(new Date(start - 3 * DAY));
    const list = await alertsOf(a.ctx(), s.eventId);
    const by = Object.fromEntries(list.map((x) => [x.rule, x]));
    expect(by.guestsUnseated).toMatchObject({ count: SOCIAL_FIXTURE.unseated, severity: 'warning' });
    expect(title(by.guestsUnseated as AlertDto)).toBe('33 guests do not have a table');
    expect(by.mealsMissing).toMatchObject({ count: 1, severity: 'warning' });
    expect(title(by.mealsMissing as AlertDto)).toBe('One attending guest has not chosen a meal');
    expect(by.rsvpPending?.severity).toBe('critical');
    // Back to today: the week-before rules resolve on their own.
    await s.evaluate();
    expect((await alertsOf(a.ctx(), s.eventId)).map((x) => x.rule)).toEqual(['rsvpPending']);
  });
});

describe('it clears as guests answer', () => {
  it('a household answering lowers the count from the outbox alone; the last answer resolves it', async () => {
    const own = await socialPackScenario(a.org.id, { ctx: a.ctx(), deps });
    expect(await rule('rsvpPending', a.ctx(), own.eventId)).toMatchObject({ count: 42 });
    await own.answer(own.pending[0] as (typeof own.pending)[number], 'attending');
    // The party's answer is an outbox event the evaluator handles (no sweep needed).
    await catchUpAlerts(a.org.id, deps);
    const after = await rule('rsvpPending', a.ctx(), own.eventId);
    expect(after).toMatchObject({ count: 39 });
    expect(title(after as AlertDto)).toBe('39 guests have not responded to RSVP');
    expect((await load(rsvpWidget, a.ctx(), own.eventId)).pending).toBe(39);
    // Partial answers count too: one guest of the next household answers (picked up by the sweep).
    await own.answer(
      {
        ...(own.pending[1] as (typeof own.pending)[number]),
        guestIds: [own.pending[1]?.guestIds[0] as string],
      },
      'declined',
    );
    await own.evaluate();
    expect(await rule('rsvpPending', a.ctx(), own.eventId)).toMatchObject({ count: 38 });
    for (const p of own.pending.slice(1)) await own.answer(p, 'declined');
    await catchUpAlerts(a.org.id, deps);
    expect(await rule('rsvpPending', a.ctx(), own.eventId)).toBeUndefined();
    const resolved = (await alertsOf(a.ctx(), own.eventId, 'resolved')).find((x) => x.rule === 'rsvpPending');
    expect(resolved?.state).toBe('resolved');
    expect(await load(rsvpWidget, a.ctx(), own.eventId)).toMatchObject({ pending: 0, responded: 45 });
  });
});

describe('the widgets', () => {
  it('guest seating: the seating editor’s unseated guests, names only', async () => {
    const w = await load(guestSeatingWidget);
    expect(w).toMatchObject({ hasChart: true, guests: 44, unseated: SOCIAL_FIXTURE.unseated, more: 25 });
    expect(w.list).toHaveLength(8);
    expect(w.list[0]).toEqual({ name: 'Alex Dubois', guestOf: null, partyName: 'Dubois' });
    // Seated, declined and the attending Riveras are not listed.
    expect(JSON.stringify(w)).not.toMatch(/Rivera|Nakamura|Abara/);
  });

  it('meals and dietary: counts per menu option, needs counted but never shown', async () => {
    const w = await load(mealsWidget);
    expect(w).toMatchObject({
      attending: 2,
      options: [
        { label: 'Beef', notes: null, count: 1 },
        { label: 'Risotto', notes: 'Vegetarian', count: 0 },
      ],
      other: 0,
      none: 1,
      dietary: 1,
      accessibility: 1,
    });
    expect(JSON.stringify(w)).not.toMatch(/Gluten|Wheelchair/i);
  });

  it('arrivals: expected guests and the latest check-ins', async () => {
    expect(await load(arrivalsWidget)).toMatchObject({
      expected: 44,
      arrived: 0,
      notArrived: 44,
      recent: [],
    });
    await s.arriveSofia();
    const w = await load(arrivalsWidget);
    expect(w).toMatchObject({ expected: 44, arrived: 1, notArrived: 43 });
    expect(w.recent).toEqual([
      expect.objectContaining({ name: 'Sofia Rivera', partyName: 'Rivera', source: 'host' }),
    ]);
  });
});

describe('who may see them', () => {
  it('ops sees all four; the door sees seating and arrivals only (never RSVP or meals)', async () => {
    for (const w of PACK) await expect(load(w, as('manager'))).resolves.toBeTruthy();
    await expect(load(guestSeatingWidget, as('door'))).resolves.toMatchObject({ unseated: 33 });
    await expect(load(arrivalsWidget, as('door'))).resolves.toMatchObject({ expected: 44 });
    await expect(load(rsvpWidget, as('door'))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(load(mealsWidget, as('door'))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('finance and marketing get none, and the alert follows the rule’s permission', async () => {
    for (const role of ['finance', 'marketing'])
      for (const w of PACK) await expect(load(w, as(role))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await rule('rsvpPending', as('finance'))).toBeUndefined();
    expect(await rule('rsvpPending', as('viewer'))).toMatchObject({ count: 42 });
  });

  it('not on events without a guest-list profile', async () => {
    const concert = await executeCommand(
      createEventCommand,
      {
        name: 'Plain concert',
        slug: `concert-${uuidv7().slice(-8)}`,
        profile: 'concert',
        timezone: 'America/Chicago',
        startsAt: new Date(Date.now() + 9 * DAY).toISOString(),
        endsAt: new Date(Date.now() + 9 * DAY + 3_600_000).toISOString(),
      },
      a.ctx(),
      ports,
    );
    await expect(load(rsvpWidget, a.ctx(), concert.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('tenant isolation', () => {
  it('another org sees neither the widgets nor the alert', async () => {
    for (const w of PACK)
      await expect(load(w, b.ctx())).rejects.toMatchObject({
        code: expect.stringMatching(/not_found|forbidden/),
      });
    expect(await alertsOf(b.ctx(), s.eventId)).toEqual([]);
  });
});
