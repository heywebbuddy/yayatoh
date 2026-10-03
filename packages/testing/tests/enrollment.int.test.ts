import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { ticketCancelBulk } from '@yayatoh/orders';
import { consumeEvent, memoryNotifier, recentEventsTx } from '@yayatoh/platform';
import {
  createSessionCommand,
  createSessionGroupCommand,
  setSessionAgendaCommand,
  updateSessionCommand,
} from '@yayatoh/program';
import {
  acceptSessionOfferCommand,
  type ConflictChoice,
  dropSessionCommand,
  enrollmentMailer,
  enrollmentOverviewQuery,
  enrollSessionCommand,
  myScheduleQuery,
  promoteSessionNowCommand,
  registrantsOfLinkTx,
  registrationEnrollment,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  setEnrollmentSettingsCommand,
  setItemSessionsCommand,
  startRegistrationCommand,
  sweepEnrollmentsCommand,
} from '@yayatoh/registration';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.2b — atomic session enrollment and the session waitlist: no oversell under concurrency
 * (200 parallel enrollments for 50 places), availability by admission item, conflicts and the
 * pick-one group, FIFO promotion (auto and offer), the 24 h close, the re-check on promotion,
 * cancelled registrants, the organizer's actions, viewer refusals, isolation and the entitlement.
 */

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const H = 3_600_000;
const START = new Date('2030-06-03T14:00:00Z');
const at = (h: number) => new Date(START.getTime() + h * H);
const anon = (now?: Date, org = a): Ctx => createCtx({ orgId: org.org.id, ...(now ? { now } : {}) });
const sys = (org = a) => systemCtx(org.org.id);
const viewer = () => userCtx(a.viewerId, a.org.id);

interface Conf {
  ev: EventDto;
  memberId: string;
  fullPass: string;
  dayPass: string;
  workshop: string;
}

/** A published conference with free Member cells for the full pass, the day pass and the workshop. */
async function conference(org = a): Promise<Conf> {
  n += 1;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Enrollment ${n} ${org.org.slug}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: at(0),
      endsAt: at(48),
    },
    org.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, org.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, org.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const item = (key: string) => setup.items.find((i) => i.key === key)?.id as string;
  for (const key of ['full_pass', 'day_pass', 'workshop'])
    await executeCommand(
      setCellCommand,
      { eventId: ev.id, registrationTypeId: member, admissionItemId: item(key), priceMinor: 0 },
      org.ctx(),
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return {
    ev,
    memberId: member,
    fullPass: item('full_pass'),
    dayPass: item('day_pass'),
    workshop: item('workshop'),
  };
}

/** An optional session (or included), `h` hours after the start, one hour long by default. */
async function session(
  c: Conf,
  title: string,
  h: number,
  opts: {
    capacity?: number | null;
    len?: number;
    groupId?: string;
    admission?: 'included' | 'optional';
  } = {},
  org = a,
) {
  const res = await executeCommand(
    createSessionCommand,
    {
      eventId: c.ev.id,
      title,
      startsAt: at(h),
      endsAt: at(h + (opts.len ?? 1)),
      capacity: opts.capacity === undefined ? 10 : opts.capacity,
    },
    org.ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    {
      eventId: c.ev.id,
      sessionId: res.session.id,
      admission: opts.admission ?? 'optional',
      groupId: opts.groupId ?? null,
    },
    org.ctx(),
    ports,
  );
  return res.session;
}

interface Person {
  token: string;
  id: string;
  email: string;
  orderId: string;
}

/** A free registration (sold at once); its manage link and registrant (the admission ticket). */
async function registrant(c: Conf, items = [c.fullPass], org = a): Promise<Person> {
  n += 1;
  const email = `enrol${n}@example.test`;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: c.ev.id,
      registrationTypeId: c.memberId,
      itemIds: items,
      buyer: { email, name: `Person ${n}` },
    },
    anon(undefined, org),
    ports,
  );
  const [reg] = await withTenant(sys(org), (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  return { token: r.manageToken, id: reg.id, email, orderId: r.order.id };
}

const enrol = (p: Person, sessionId: string, choice: ConflictChoice = 'refuse', now?: Date, org = a) =>
  executeCommand(
    enrollSessionCommand,
    { token: p.token, registrantId: p.id, sessionId, choice },
    anon(now ?? at(-72), org),
    ports,
  );
const drop = (p: Person, sessionId: string, now?: Date) =>
  executeCommand(
    dropSessionCommand,
    { token: p.token, registrantId: p.id, sessionId },
    anon(now ?? at(-72)),
    ports,
  );
const schedule = (p: Person, now?: Date) =>
  executeQuery(myScheduleQuery, { token: p.token, registrantId: p.id }, anon(now ?? at(-72)), ports);
const stateIn = async (p: Person, sessionId: string, now?: Date) =>
  (await schedule(p, now)).sessions.find((s) => s.sessionId === sessionId);

const counter = async (sessionId: string) =>
  (
    await withTenant(sys(), (tx) =>
      tx.execute<{ enrolled: number; capacity: number | null }>(
        sql`select enrolled, capacity from program.session_details where session_id = ${sessionId}`,
      ),
    )
  )[0];
const statuses = async (sessionId: string) =>
  Object.fromEntries(
    (
      await withTenant(sys(), (tx) =>
        tx.execute<{ status: string; n: number }>(
          sql`select status, count(*)::int as n from registration.session_enrollments where session_id = ${sessionId} group by status`,
        ),
      )
    ).map((r) => [r.status, r.n]),
  );
const promotedEvents = async (sessionId: string) =>
  (
    await withTenant(sys(), (tx) => recentEventsTx(tx, a.org.id, ['registration.session.promoted'], H))
  ).filter((e) => (e.payload as { sessionId?: string }).sessionId === sessionId);

async function inChunks<T, R>(items: readonly T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('atomic enrollment (M5.2b)', () => {
  it('no oversell under concurrency: 200 parallel enrollments for 50 places give exactly 50', async () => {
    const c = await conference();
    const s = await session(c, 'Popular workshop', 2, { capacity: 50 });
    const people = await inChunks(
      Array.from({ length: 200 }, (_, i) => i),
      20,
      () => registrant(c),
    );
    const results = await Promise.allSettled(people.map((p) => enrol(p, s.id)));
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const got = results.map((r) => (r as PromiseFulfilledResult<{ status: string }>).value.status);
    expect(got.filter((x) => x === 'enrolled')).toHaveLength(50);
    expect(got.filter((x) => x === 'waiting')).toHaveLength(150);
    expect(await counter(s.id)).toEqual({ enrolled: 50, capacity: 50 });
    expect(await statuses(s.id)).toEqual({ enrolled: 50, waiting: 150 });
    // The waiting line is numbered 1…150 with no gaps or repeats.
    const positions = (
      await Promise.all(
        people.map(async (p) => {
          const st = await stateIn(p, s.id);
          return st?.state === 'waiting' ? st.position : null;
        }),
      )
    ).filter((x): x is number => x !== null);
    expect(positions.sort((x, y) => x - y)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    // The CHECK is the last line of defence: a raw increment past capacity is refused.
    await expect(
      withTenant(sys(), (tx) =>
        tx.execute(
          sql`update program.session_details set enrolled = enrolled + 1 where session_id = ${s.id}`,
        ),
      ),
    ).rejects.toThrow();
  }, 180_000);

  it('enrolling twice returns the place held; the schedule shows included and enrolled sessions', async () => {
    const c = await conference();
    const keynote = await session(c, 'Keynote', 0, { admission: 'included', capacity: null });
    const w = await session(c, 'Workshop', 2);
    const p = await registrant(c);
    expect(await enrol(p, w.id)).toEqual({ status: 'enrolled', position: null, replaced: [] });
    expect(await enrol(p, w.id)).toEqual({ status: 'enrolled', position: null, replaced: [] });
    expect(await counter(w.id)).toMatchObject({ enrolled: 1 });
    const sched = await schedule(p);
    expect(sched.sessions.map((x) => [x.title, x.state])).toEqual([
      ['Keynote', 'included'],
      ['Workshop', 'enrolled'],
    ]);
    // Included sessions need no enrollment.
    await expect(enrol(p, keynote.id)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'included' },
    });
    // Allowlisted: no counts or capacities reach the attendee.
    expect(JSON.stringify(sched)).not.toMatch(/capacity|enrolled":\d/);
  });

  it('availability comes from the admission item (and add-ons)', async () => {
    const c = await conference();
    const a1 = await session(c, 'Day one talk', 1);
    const a2 = await session(c, 'Day two talk', 26);
    const ws = await session(c, 'Paid workshop', 4);
    await executeCommand(
      setItemSessionsCommand,
      { eventId: c.ev.id, admissionItemId: c.dayPass, sessionIds: [a1.id] },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setItemSessionsCommand,
      { eventId: c.ev.id, admissionItemId: c.workshop, sessionIds: [ws.id] },
      a.ctx(),
      ports,
    );
    const day = await registrant(c, [c.dayPass]);
    expect((await schedule(day)).sessions.map((s) => s.title)).toEqual(['Day one talk']);
    await expect(enrol(day, a2.id)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'not_available' },
    });
    const dayWorkshop = await registrant(c, [c.dayPass, c.workshop]);
    expect((await schedule(dayWorkshop)).sessions.map((s) => s.title)).toEqual([
      'Day one talk',
      'Paid workshop',
    ]);
    expect(await enrol(dayWorkshop, ws.id)).toMatchObject({ status: 'enrolled' });
    // The full pass lists nothing: every session.
    const full = await registrant(c);
    expect((await schedule(full)).sessions).toHaveLength(3);
    // Unknown sessions are refused in the listing.
    await expect(
      executeCommand(
        setItemSessionsCommand,
        { eventId: c.ev.id, admissionItemId: c.dayPass, sessionIds: [b.event.id] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'sessionIds' } });
  });

  it('overlapping sessions are refused with the one in the way; replace swaps; keep both only uncapped', async () => {
    const c = await conference();
    const x = await session(c, 'Session X', 2, { capacity: 5 });
    const y = await session(c, 'Session Y', 2.5, { capacity: 5 });
    const p = await registrant(c);
    await enrol(p, x.id);
    await expect(enrol(p, y.id)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'overlap', sessionId: x.id, sessionTitle: 'Session X', keepBoth: false },
    });
    await expect(enrol(p, y.id, 'keep_both')).rejects.toMatchObject({
      details: { reason: 'keep_both_capped', sessionTitle: 'Session X' },
    });
    expect(await enrol(p, y.id, 'replace')).toEqual({ status: 'enrolled', position: null, replaced: [x.id] });
    expect(await counter(x.id)).toMatchObject({ enrolled: 0 });
    expect(await counter(y.id)).toMatchObject({ enrolled: 1 });
    // P5-9: two uncapped overlapping sessions may be kept both.
    const u1 = await session(c, 'Open talk 1', 6, { capacity: null });
    const u2 = await session(c, 'Open talk 2', 6, { capacity: null });
    await enrol(p, u1.id);
    await expect(enrol(p, u2.id)).rejects.toMatchObject({ details: { reason: 'overlap', keepBoth: true } });
    expect(await enrol(p, u2.id, 'keep_both')).toMatchObject({ status: 'enrolled', replaced: [] });
    // Back-to-back is not an overlap.
    const next = await session(c, 'Right after', 7, { capacity: 3 });
    expect(await enrol(p, next.id)).toMatchObject({ status: 'enrolled' });
  });

  it('a session group allows exactly one pick (refused, then replaced; the DB guard holds)', async () => {
    const c = await conference();
    const g = await executeCommand(
      createSessionGroupCommand,
      { eventId: c.ev.id, name: `Pick ${n}` },
      a.ctx(),
      ports,
    );
    const s1 = await session(c, 'Track A', 3, { groupId: g.id });
    const s2 = await session(c, 'Track B', 3, { groupId: g.id });
    const p = await registrant(c);
    await enrol(p, s1.id);
    await expect(enrol(p, s2.id)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'one_per_group', sessionTitle: 'Track A' },
    });
    expect(await enrol(p, s2.id, 'replace')).toMatchObject({ status: 'enrolled', replaced: [s1.id] });
    const picks = await withTenant(sys(), (tx) =>
      tx.execute<{ session_id: string }>(
        sql`select session_id from program.session_group_picks where group_id = ${g.id} and registrant_id = ${p.id}`,
      ),
    );
    expect(picks.map((r) => r.session_id)).toEqual([s2.id]);
    // Concurrent picks of both sessions by one person: exactly one wins.
    const q = await registrant(c);
    const both = await Promise.allSettled([enrol(q, s1.id), enrol(q, s2.id)]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isDomainError(lost.reason) && lost.reason.code).toBe('conflict');
  });
});

describe('the session waitlist (M5.2b, P5-9)', () => {
  it('auto mode: FIFO; a drop enrols the next person at once and emits the promotion', async () => {
    const c = await conference();
    const s = await session(c, 'Tiny room', 4, { capacity: 1 });
    const [p1, p2, p3] = [await registrant(c), await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    expect(await enrol(p2, s.id)).toEqual({ status: 'waiting', position: 1, replaced: [] });
    expect(await enrol(p3, s.id)).toEqual({ status: 'waiting', position: 2, replaced: [] });
    expect(await stateIn(p2, s.id)).toMatchObject({ state: 'waiting', position: 1 });
    expect(await drop(p1, s.id)).toEqual({ status: 'dropped' });
    expect(await stateIn(p2, s.id)).toMatchObject({ state: 'enrolled' });
    expect(await stateIn(p3, s.id)).toMatchObject({ state: 'waiting', position: 1 });
    expect(await stateIn(p1, s.id)).toMatchObject({ state: 'full' });
    expect(await counter(s.id)).toMatchObject({ enrolled: 1 });
    const events = await promotedEvents(s.id);
    expect(events.map((e) => (e.payload as { status: string }).status)).toEqual(['enrolled']);
    // Leaving the line frees nothing and promotes nobody.
    expect(await drop(p3, s.id)).toEqual({ status: 'left' });
    expect(await statuses(s.id)).toEqual({ enrolled: 1, dropped: 1, left: 1 });
  });

  it('the promotion email links to the schedule (once per entry)', async () => {
    const c = await conference();
    const s = await session(c, 'Mailed room', 4, { capacity: 1 });
    const [p1, p2] = [await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    await drop(p1, s.id);
    const [event] = await promotedEvents(s.id);
    if (!event) throw new Error('no promotion');
    const mem = memoryNotifier();
    const mailer = enrollmentMailer({ notifier: mem.notifier, appOrigin: 'https://app.test' });
    expect(await consumeEvent(mailer, event)).toBe(true);
    expect(await consumeEvent(mailer, event)).toBe(false);
    expect(mem.sent).toHaveLength(1);
    expect(mem.sent[0]).toMatchObject({
      kind: 'registration.session-enrolled',
      to: { email: p2.email },
      params: { sessionTitle: 'Mailed room', eventName: c.ev.name },
    });
    expect(String(mem.sent[0]?.params.url)).toMatch(
      new RegExp(`^https://app\\.test/orders/${p2.token}/schedule\\?registrant=${p2.id}$`),
    );
  });

  it('offer mode: the next person is offered the place, accepts it; a lapsed offer goes to the next', async () => {
    const c = await conference();
    await executeCommand(
      setEnrollmentSettingsCommand,
      { eventId: c.ev.id, promotion: 'offer', offerMinutes: 60 },
      a.ctx(),
      ports,
    );
    const s = await session(c, 'Offer room', 10, { capacity: 1 });
    const [p1, p2, p3, p4] = [
      await registrant(c),
      await registrant(c),
      await registrant(c),
      await registrant(c),
    ];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    await enrol(p3, s.id);
    await enrol(p4, s.id);
    await drop(p1, s.id);
    const offered = await stateIn(p2, s.id);
    expect(offered).toMatchObject({ state: 'offered' });
    expect(offered?.offerExpiresAt).toEqual(new Date(at(-72).getTime() + 60 * 60_000));
    // The offer holds the place: nobody else may take it.
    expect(await counter(s.id)).toMatchObject({ enrolled: 1 });
    expect(
      await executeCommand(
        acceptSessionOfferCommand,
        { token: p2.token, registrantId: p2.id, sessionId: s.id },
        anon(at(-71.5)),
        ports,
      ),
    ).toMatchObject({ status: 'enrolled' });
    // p2 drops → p3 offered; p3 lets it lapse → the sweeper gives it to p4.
    await drop(p2, s.id, at(-71));
    expect(await stateIn(p3, s.id, at(-71))).toMatchObject({ state: 'offered' });
    const lapse = at(-69);
    await expect(
      executeCommand(
        acceptSessionOfferCommand,
        { token: p3.token, registrantId: p3.id, sessionId: s.id },
        anon(lapse),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'offer_ended' } });
    const sweep = await executeCommand(
      sweepEnrollmentsCommand,
      { eventId: c.ev.id },
      { ...sys(), now: lapse },
      ports,
    );
    expect(sweep).toMatchObject({ expired: 1, promoted: 1 });
    expect(await stateIn(p3, s.id, lapse)).toMatchObject({ state: 'full' });
    expect(await stateIn(p4, s.id, lapse)).toMatchObject({ state: 'offered' });
    // Sweeping again changes nothing (idempotent), and the counter never moved past 1.
    expect(
      await executeCommand(sweepEnrollmentsCommand, { eventId: c.ev.id }, { ...sys(), now: lapse }, ports),
    ).toEqual({ expired: 0, promoted: 0, skipped: 0 });
    expect(await counter(s.id)).toMatchObject({ enrolled: 1 });
    // Declining an offer frees the place too.
    expect(await drop(p4, s.id, lapse)).toEqual({ status: 'declined' });
    expect(await counter(s.id)).toMatchObject({ enrolled: 0 });
  });

  it('promotion stops 24 h before the start; the line closes and the door decides', async () => {
    const c = await conference();
    const s = await session(c, 'Late room', 30, { capacity: 1 });
    const [p1, p2, p3] = [await registrant(c), await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    const closed = at(30 - 23);
    // p1 drops 23 h before: nobody is promoted, p2 keeps waiting.
    await drop(p1, s.id, closed);
    expect(await stateIn(p2, s.id, closed)).toMatchObject({ state: 'waiting' });
    expect(await counter(s.id)).toMatchObject({ enrolled: 0 });
    await expect(
      executeCommand(
        promoteSessionNowCommand,
        { eventId: c.ev.id, sessionId: s.id },
        { ...a.ctx(), now: closed },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'promotion_closed' } });
    expect(
      await executeCommand(sweepEnrollmentsCommand, { eventId: c.ev.id }, { ...sys(), now: closed }, ports),
    ).toMatchObject({ promoted: 0 });
    // A free place after the close is first come (the door line decides from here).
    expect(await enrol(p3, s.id, 'refuse', closed)).toMatchObject({ status: 'enrolled' });
    // Full after the close: the line no longer takes people.
    const p4 = await registrant(c);
    await expect(enrol(p4, s.id, 'refuse', closed)).rejects.toMatchObject({
      details: { reason: 'waitlist_closed' },
    });
    expect(await stateIn(p4, s.id, closed)).toMatchObject({ state: 'waitlist_closed' });
    // Exactly at the close (24 h) it is already closed; just before, it still promotes.
    const s2 = await session(c, 'Edge room', 40, { capacity: 1 });
    await enrol(p1, s2.id);
    await enrol(p2, s2.id);
    await drop(p1, s2.id, at(40 - 24));
    expect(await stateIn(p2, s2.id, at(40 - 24))).toMatchObject({ state: 'waiting' });
    const s3 = await session(c, 'Edge room 2', 44, { capacity: 1 });
    await enrol(p1, s3.id);
    await enrol(p2, s3.id);
    await drop(p1, s3.id, new Date(at(44 - 24).getTime() - 1));
    expect(await stateIn(p2, s3.id, at(0 - 1))).toMatchObject({ state: 'enrolled' });
  });

  it('re-checks conflicts and availability on promotion: a person who no longer fits is passed over', async () => {
    const c = await conference();
    const s = await session(c, 'Wanted', 5, { capacity: 1 });
    const other = await session(c, 'Clashing', 5, { capacity: 5 });
    const [p1, p2, p3] = [await registrant(c), await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    await enrol(p3, s.id);
    // p2 enrols in an overlapping session meanwhile.
    await enrol(p2, other.id);
    await drop(p1, s.id);
    expect(await stateIn(p3, s.id)).toMatchObject({ state: 'enrolled' });
    const [row] = await withTenant(sys(), (tx) =>
      tx.execute<{ status: string; skip_reason: string }>(
        sql`select status, skip_reason from registration.session_enrollments where session_id = ${s.id} and registrant_id = ${p2.id}`,
      ),
    );
    expect(row).toEqual({ status: 'skipped', skip_reason: 'overlap' });
    // p2 can't join while holding the clash.
    await expect(enrol(p2, s.id)).rejects.toMatchObject({ details: { reason: 'overlap' } });
  });

  it('organizer: per-session counts, "promote now" after a capacity raise, capacity below places refused', async () => {
    const c = await conference();
    const s = await session(c, 'Raise me', 6, { capacity: 1 });
    const [p1, p2, p3] = [await registrant(c), await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    await enrol(p3, s.id);
    const overview = await executeQuery(
      enrollmentOverviewQuery,
      { eventId: c.ev.id },
      a.ctx({ now: at(-72) }),
      ports,
    );
    expect(overview.sessions.find((x) => x.sessionId === s.id)).toMatchObject({
      capacity: 1,
      enrolled: 1,
      waiting: 2,
      offered: 0,
      promotionOpen: true,
      promotionClosesAt: at(6 - 24),
    });
    expect(overview.settings).toEqual({ promotion: 'auto', offerMinutes: 240 });
    expect(overview.items.find((i) => i.admissionItemId === c.fullPass)).toMatchObject({ all: true });
    const update = (capacity: number) =>
      executeCommand(
        updateSessionCommand,
        { eventId: c.ev.id, sessionId: s.id, title: 'Raise me', startsAt: at(6), endsAt: at(7), capacity },
        a.ctx(),
        ports,
      );
    await update(3);
    expect(
      await executeCommand(
        promoteSessionNowCommand,
        { eventId: c.ev.id, sessionId: s.id },
        { ...a.ctx(), now: at(-72) },
        ports,
      ),
    ).toEqual({ promoted: 2, skipped: 0 });
    expect(await statuses(s.id)).toEqual({ enrolled: 3 });
    expect(
      await executeCommand(
        promoteSessionNowCommand,
        { eventId: c.ev.id, sessionId: s.id },
        { ...a.ctx(), now: at(-72) },
        ports,
      ),
    ).toEqual({ promoted: 0, skipped: 0 });
    // M5.2a's leftover: lowering the capacity under the places held is a clear refusal.
    await expect(update(2)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'capacity_below_enrolled', field: 'capacity' },
    });
  });

  it('a cancelled registrant gives their places back and the line moves', async () => {
    const c = await conference();
    const s = await session(c, 'Cancel room', 8, { capacity: 1 });
    const [p1, p2] = [await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    const attendees = await withTenant(sys(), (tx) =>
      tx.execute<{ id: string }>(
        sql`select a.id from attendees.attendees a join ticketing.tickets t on t.id = a.ticket_id where t.order_id = ${p1.orderId}`,
      ),
    );
    const op = await executeCommand(
      ticketCancelBulk.start,
      { eventId: c.ev.id, selection: { ids: attendees.map((x) => x.id) }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    const sub = registrationEnrollment();
    const cancelled = (
      await withTenant(sys(), (tx) => recentEventsTx(tx, a.org.id, ['tickets.cancelled'], H))
    ).filter((e) => ((e.payload as { ticketIds?: string[] }).ticketIds ?? []).includes(p1.id));
    expect(cancelled).toHaveLength(1);
    for (const e of cancelled) await consumeEvent(sub, e);
    // A replay changes nothing.
    for (const e of cancelled) await withTenant(sys(), (tx) => sub.handle(tx, e));
    expect(await statuses(s.id)).toEqual({ cancelled: 1, enrolled: 1 });
    expect(await counter(s.id)).toMatchObject({ enrolled: 1 });
    // The cancelled registrant's link no longer finds a registrant.
    await expect(enrol(p1, s.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('permissions, isolation, entitlement (M5.2b)', () => {
  it('a viewer reads the enrollment overview but every organizer action is refused', async () => {
    const c = await conference();
    const s = await session(c, 'Viewer room', 3, { capacity: 1 });
    await expect(
      executeQuery(enrollmentOverviewQuery, { eventId: c.ev.id }, viewer(), ports),
    ).resolves.toMatchObject({
      eventId: c.ev.id,
    });
    for (const [cmd, input] of [
      [promoteSessionNowCommand, { eventId: c.ev.id, sessionId: s.id }],
      [setEnrollmentSettingsCommand, { eventId: c.ev.id, promotion: 'offer', offerMinutes: 60 }],
      [setItemSessionsCommand, { eventId: c.ev.id, admissionItemId: c.dayPass, sessionIds: [s.id] }],
    ] as const)
      await expect(executeCommand(cmd as never, input, viewer(), ports)).rejects.toMatchObject({
        code: 'forbidden',
      });
    // The sweeper is the platform's: members can't run it.
    await expect(executeCommand(sweepEnrollmentsCommand, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('another org sees nothing and can’t enrol across orgs, even with a real link', async () => {
    const c = await conference();
    const s = await session(c, 'Isolated', 3, { capacity: 2 });
    const p = await registrant(c);
    await expect(
      executeQuery(enrollmentOverviewQuery, { eventId: c.ev.id }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(promoteSessionNowCommand, { eventId: c.ev.id, sessionId: s.id }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Org a's link under org b's tenant: nothing resolves.
    await expect(enrol(p, s.id, 'refuse', undefined, b)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(myScheduleQuery, { token: p.token, registrantId: p.id }, anon(undefined, b), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Org b's registrant can't reach org a's session.
    const cb = await conference(b);
    const pb = await registrant(cb, [cb.fullPass], b);
    await expect(enrol(pb, s.id, 'refuse', undefined, b)).rejects.toMatchObject({ code: 'not_found' });
    // A forged registrant id (someone else's ticket) under a valid link is not found.
    const q = await registrant(c);
    await expect(
      executeCommand(
        enrollSessionCommand,
        { token: p.token, registrantId: q.id, sessionId: s.id, choice: 'refuse' },
        anon(at(-72)),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Raw reads under org b's RLS see none of org a's rows.
    const rows = await withTenant(sys(b), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from registration.session_enrollments where org_id = ${a.org.id}`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('a revoked registration module refuses enrollment, the schedule and the organizer page', async () => {
    const c = await conference();
    const s = await session(c, 'Gated', 3);
    const p = await registrant(c);
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'registration', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(enrol(p, s.id)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(schedule(p)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(
        executeQuery(enrollmentOverviewQuery, { eventId: c.ev.id }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'module_not_enabled' });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'registration', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });
});

describe('impersonation and the read-only freeze (M5.2b)', () => {
  it('staff acting as the owner may promote (audited with both names); nothing here is money, export or delete', async () => {
    const c = await conference();
    const s = await session(c, 'Staff room', 3, { capacity: 1 });
    const [p1, p2] = [await registrant(c), await registrant(c)];
    await enrol(p1, s.id);
    await enrol(p2, s.id);
    await drop(p1, s.id);
    const staffUserId = uuidv7();
    const acting = a.ctx({ impersonatedBy: { staffUserId, impersonationId: uuidv7() }, now: at(-72) });
    expect(
      await executeCommand(promoteSessionNowCommand, { eventId: c.ev.id, sessionId: s.id }, acting, ports),
    ).toEqual({ promoted: 0, skipped: 0 });
    const [audit] = await withTenant(sys(), (tx) =>
      tx.execute<{ data: unknown; n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'registration.session.promote' and target_id = ${s.id}`,
      ),
    );
    expect(audit?.n).toBe(1);
    for (const cmd of [
      enrollSessionCommand,
      dropSessionCommand,
      acceptSessionOfferCommand,
      promoteSessionNowCommand,
      setEnrollmentSettingsCommand,
      setItemSessionsCommand,
      sweepEnrollmentsCommand,
    ])
      expect(cmd.category, cmd.name).toBeUndefined();
  });

  it('a frozen org refuses enrollment and the organizer actions; the schedule still reads', async () => {
    const c = await conference();
    const s = await session(c, 'Frozen room', 3, { capacity: 2 });
    const p = await registrant(c);
    const admin = adminClient();
    const setFreeze = (value: unknown) =>
      admin`select platform.set_ops_flag('read_only_freeze', ${value === null ? null : JSON.stringify(value)}::text::jsonb, 'test', 'test:enrollment')`;
    await setFreeze({ scope: 'orgs', orgIds: [a.org.id] });
    try {
      await expect(enrol(p, s.id)).rejects.toMatchObject({ code: 'read_only_freeze' });
      await expect(
        executeCommand(promoteSessionNowCommand, { eventId: c.ev.id, sessionId: s.id }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'read_only_freeze' });
      expect((await schedule(p)).sessions.map((x) => x.state)).toEqual(['open']);
    } finally {
      await setFreeze(null);
      await admin.end();
    }
    expect(await enrol(p, s.id)).toMatchObject({ status: 'enrolled' });
  });
});
