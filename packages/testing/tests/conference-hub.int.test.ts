import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { ticketCancelBulk } from '@yayatoh/orders';
import { createSessionCommand, setSessionAgendaCommand, updateSessionCommand } from '@yayatoh/program';
import {
  calendarFeedIcs,
  calendarFeedQuery,
  calendarFeedTarget,
  conferenceHubQuery,
  enrollSessionCommand,
  type FavoriteChoice,
  favoriteSessionCommand,
  registrantsOfLinkTx,
  registrationSetupQuery,
  rotateCalendarFeedCommand,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  setItemSessionsCommand,
  signFeedToken,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M5.10a — the attendee conference hub: favorites with conflict prompts, the personal schedule,
 * the signed calendar feed (and that it follows a session the organizer moves), replacing the
 * feed link, isolation and the entitlement.
 */

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const H = 3_600_000;
const SECRET = 'hub-test-secret';
const START = new Date('2030-09-02T14:00:00Z');
const at = (h: number) => new Date(START.getTime() + h * H);
const NOW = at(-72);
const anon = (org = a, now = NOW): Ctx => createCtx({ orgId: org.org.id, now });
const sys = (org = a) => systemCtx(org.org.id);

interface Conf {
  ev: EventDto;
  memberId: string;
  fullPass: string;
  workshop: string;
}

async function conference(org = a): Promise<Conf> {
  n += 1;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Hub ${n} ${org.org.slug}`,
      profile: 'conference',
      timezone: 'Europe/Berlin',
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
  for (const key of ['full_pass', 'workshop'])
    await executeCommand(
      setCellCommand,
      { eventId: ev.id, registrationTypeId: member, admissionItemId: item(key), priceMinor: 0 },
      org.ctx(),
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return { ev, memberId: member, fullPass: item('full_pass'), workshop: item('workshop') };
}

async function session(
  c: Conf,
  title: string,
  h: number,
  opts: { capacity?: number | null; len?: number; admission?: 'included' | 'optional' } = {},
  org = a,
) {
  const res = await executeCommand(
    createSessionCommand,
    {
      eventId: c.ev.id,
      title,
      startsAt: at(h),
      endsAt: at(h + (opts.len ?? 1)),
      capacity: opts.capacity === undefined ? null : opts.capacity,
    },
    org.ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    { eventId: c.ev.id, sessionId: res.session.id, admission: opts.admission ?? 'included', groupId: null },
    org.ctx(),
    ports,
  );
  return res.session;
}

interface Person {
  token: string;
  id: string;
  orderId: string;
}

async function registrant(c: Conf, items = [c.fullPass], org = a): Promise<Person> {
  n += 1;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: c.ev.id,
      registrationTypeId: c.memberId,
      itemIds: items,
      buyer: { email: `hub${n}@example.test`, name: `Hub Person ${n}` },
    },
    anon(org),
    ports,
  );
  const [reg] = await withTenant(sys(org), (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  return { token: r.manageToken, id: reg.id, orderId: r.order.id };
}

const star = (p: Person, sessionId: string, choice: FavoriteChoice = 'refuse', org = a, favorite = true) =>
  executeCommand(
    favoriteSessionCommand,
    { token: p.token, registrantId: p.id, sessionId, favorite, choice },
    anon(org),
    ports,
  );
const unstar = (p: Person, sessionId: string) => star(p, sessionId, 'refuse', a, false);
const hub = (p: Person, org = a, now = NOW) =>
  executeQuery(conferenceHubQuery, { token: p.token, registrantId: p.id }, anon(org, now), ports);

/** The calendar feed as a calendar app sees it: the signed link → the iCalendar text. */
async function feedOf(link: string): Promise<string | null> {
  const target = await calendarFeedTarget(link, SECRET);
  if (!target) return null;
  const feed = await executeQuery(
    calendarFeedQuery,
    { registrantId: target.registrantId, version: target.version },
    createCtx({ orgId: target.orgId }),
    ports,
  );
  return calendarFeedIcs({ calendarName: feed.eventName, timezone: feed.timezone, sessions: feed.sessions });
}
const linkOf = async (p: Person, org = a) =>
  signFeedToken({ orgId: org.org.id, registrantId: p.id, version: (await hub(p, org)).feedVersion }, SECRET);
const vevent = (ics: string, sessionId: string) =>
  ics
    .replace(/\r\n /g, '')
    .split('BEGIN:VEVENT')
    .find((block) => block.includes(`UID:session-${sessionId}@yayatoh`));

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('favorites and the personal schedule (M5.10a)', () => {
  it('stars and un-stars a session (idempotent both ways); the hub marks it on the schedule', async () => {
    const c = await conference();
    const s = await session(c, 'Opening keynote', 1);
    const p = await registrant(c);
    expect(await star(p, s.id)).toEqual({ favorite: true, removed: [] });
    expect(await star(p, s.id)).toEqual({ favorite: true, removed: [] });
    let mine = (await hub(p)).sessions.find((x) => x.sessionId === s.id);
    expect(mine).toMatchObject({ favorite: true, onSchedule: true, conflicts: [], state: 'included' });
    expect(await unstar(p, s.id)).toEqual({ favorite: false, removed: [] });
    expect(await unstar(p, s.id)).toEqual({ favorite: false, removed: [] });
    mine = (await hub(p)).sessions.find((x) => x.sessionId === s.id);
    expect(mine).toMatchObject({ favorite: false, onSchedule: false });
    // Persisted once per registrant and session.
    const rows = await withTenant(sys(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from registration.session_favorites where registrant_id = ${p.id}`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('only sessions the registrant’s items give can be starred', async () => {
    const c = await conference();
    const general = await session(c, 'General session', 1);
    const extra = await session(c, 'Add-on lab', 3, { admission: 'optional', capacity: 5 });
    await executeCommand(
      setItemSessionsCommand,
      { eventId: c.ev.id, admissionItemId: c.workshop, sessionIds: [extra.id] },
      a.ctx(),
      ports,
    );
    // The full pass lists only the general session; the add-on is the workshop's.
    await executeCommand(
      setItemSessionsCommand,
      { eventId: c.ev.id, admissionItemId: c.fullPass, sessionIds: [general.id] },
      a.ctx(),
      ports,
    );
    const p = await registrant(c);
    await expect(star(p, extra.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await hub(p)).sessions.map((x) => x.sessionId)).toEqual([general.id]);
    const q = await registrant(c, [c.fullPass, c.workshop]);
    await expect(star(q, extra.id)).resolves.toEqual({ favorite: true, removed: [] });
  });

  it('conflict prompts: an overlap is refused with the sessions in the way; keep both or replace', async () => {
    const c = await conference();
    const s1 = await session(c, 'Track A talk', 2);
    const s2 = await session(c, 'Track B talk', 2.5);
    const s3 = await session(c, 'Track C talk', 2, { len: 0.75 });
    const p = await registrant(c);
    await star(p, s1.id);
    const err = await star(p, s2.id).catch((e) => e);
    expect(err).toMatchObject({ code: 'conflict' });
    expect(err.details).toMatchObject({
      reason: 'overlap',
      replace: true,
      conflicts: [{ sessionId: s1.id, title: 'Track A talk', kind: 'favorite' }],
    });
    // Keep both: both starred, each marked as overlapping the other.
    await star(p, s2.id, 'keep_both');
    let h = await hub(p);
    expect(h.sessions.find((x) => x.sessionId === s1.id)?.conflicts).toEqual([s2.id]);
    expect(h.sessions.find((x) => x.sessionId === s2.id)?.conflicts).toEqual([s1.id]);
    // Replace: s3 overlaps both; they are un-starred.
    const res = await star(p, s3.id, 'replace');
    expect(res.removed.sort()).toEqual([s1.id, s2.id].sort());
    h = await hub(p);
    expect(h.sessions.filter((x) => x.favorite).map((x) => x.sessionId)).toEqual([s3.id]);
    expect(h.sessions.find((x) => x.sessionId === s3.id)?.conflicts).toEqual([]);
  });

  it('an enrolled session in the way is never dropped by "replace"', async () => {
    const c = await conference();
    const ws = await session(c, 'Hands-on workshop', 5, { admission: 'optional', capacity: 3 });
    const talk = await session(c, 'Parallel talk', 5.5);
    const p = await registrant(c);
    await executeCommand(
      enrollSessionCommand,
      { token: p.token, registrantId: p.id, sessionId: ws.id, choice: 'refuse' },
      anon(),
      ports,
    );
    const err = await star(p, talk.id, 'replace').catch((e) => e);
    expect(err).toMatchObject({ code: 'conflict' });
    expect(err.details).toMatchObject({
      replace: false,
      conflicts: [{ sessionId: ws.id, kind: 'enrolled' }],
    });
    await star(p, talk.id, 'keep_both');
    const h = await hub(p);
    expect(h.sessions.find((x) => x.sessionId === ws.id)).toMatchObject({
      state: 'enrolled',
      onSchedule: true,
      favorite: false,
      conflicts: [talk.id],
    });
  });

  it('concurrent stars of two overlapping sessions: exactly one wins, the other is asked', async () => {
    const c = await conference();
    const s1 = await session(c, 'Race A', 8);
    const s2 = await session(c, 'Race B', 8.25);
    const p = await registrant(c);
    const results = await Promise.allSettled([star(p, s1.id), star(p, s2.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.map((r) => r.reason.code)).toEqual(['conflict']);
  });
});

describe('the signed calendar feed (M5.10a)', () => {
  it('the ICS feed updates when a session moves (same UID, new times, higher SEQUENCE)', async () => {
    const c = await conference();
    const keynote = await session(c, 'Keynote', 1);
    const ws = await session(c, 'Workshop', 3, { admission: 'optional', capacity: 10 });
    const other = await session(c, 'Not mine', 6);
    const p = await registrant(c);
    await star(p, keynote.id);
    await executeCommand(
      enrollSessionCommand,
      { token: p.token, registrantId: p.id, sessionId: ws.id, choice: 'refuse' },
      anon(),
      ports,
    );
    const link = await linkOf(p);
    const before = await feedOf(link);
    if (!before) throw new Error('feed missing');
    expect(before.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(vevent(before, other.id)).toBeUndefined();
    expect(vevent(before, keynote.id)).toContain('STATUS:TENTATIVE');
    expect(vevent(before, ws.id)).toContain('STATUS:CONFIRMED');
    expect(vevent(before, keynote.id)).toContain('DTSTART:20300902T150000Z');
    const seq = (block?: string) => Number(block?.match(/SEQUENCE:(\d+)/)?.[1]);
    const seqBefore = seq(vevent(before, keynote.id));

    // The organizer moves the keynote two hours later.
    await new Promise((r) => setTimeout(r, 1100));
    await executeCommand(
      updateSessionCommand,
      {
        eventId: c.ev.id,
        sessionId: keynote.id,
        title: 'Keynote (moved)',
        startsAt: at(3.5),
        endsAt: at(4.5),
        capacity: null,
      },
      a.ctx(),
      ports,
    );
    const after = await feedOf(link);
    if (!after) throw new Error('feed missing');
    const moved = vevent(after, keynote.id);
    expect(moved).toContain('DTSTART:20300902T173000Z');
    expect(moved).toContain('DTEND:20300902T183000Z');
    expect(moved).toContain('SUMMARY:Keynote (moved)');
    expect(seq(moved)).toBeGreaterThan(seqBefore);
    // The unchanged session keeps its SEQUENCE.
    expect(seq(vevent(after, ws.id))).toBe(seq(vevent(before, ws.id)));

    // Un-starring takes it off the feed.
    await unstar(p, keynote.id);
    expect(vevent((await feedOf(link)) ?? '', keynote.id)).toBeUndefined();
  });

  it('a forged, replaced or cross-org link gets nothing; a cancelled ticket ends the feed', async () => {
    const c = await conference();
    const s = await session(c, 'Feed session', 1);
    const p = await registrant(c);
    await star(p, s.id);
    const link = await linkOf(p);
    expect(await feedOf(link)).toContain(`UID:session-${s.id}@yayatoh`);
    expect(await calendarFeedTarget(link, 'another-secret')).toBeNull();
    expect(
      await calendarFeedTarget(
        link.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')),
        SECRET,
      ),
    ).toBeNull();
    // Signed for org b, but the registrant is org a's: no target.
    expect(
      await calendarFeedTarget(
        signFeedToken({ orgId: b.org.id, registrantId: p.id, version: 1 }, SECRET),
        SECRET,
      ),
    ).toBeNull();
    // A later version than the current one is not valid either.
    expect(
      await calendarFeedTarget(
        signFeedToken({ orgId: a.org.id, registrantId: p.id, version: 2 }, SECRET),
        SECRET,
      ),
    ).toBeNull();

    // Replace the link: the old one stops at once, the new one works.
    expect(
      await executeCommand(rotateCalendarFeedCommand, { token: p.token, registrantId: p.id }, anon(), ports),
    ).toEqual({ version: 2 });
    expect(await feedOf(link)).toBeNull();
    const fresh = await linkOf(p);
    expect(fresh).not.toBe(link);
    expect(await feedOf(fresh)).toContain(`UID:session-${s.id}@yayatoh`);
    await executeCommand(rotateCalendarFeedCommand, { token: p.token, registrantId: p.id }, anon(), ports);
    expect((await hub(p)).feedVersion).toBe(3);
    // The query checks the version again under RLS.
    await expect(
      executeQuery(calendarFeedQuery, { registrantId: p.id, version: 2 }, anon(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });

    // The registration is cancelled: the feed is gone.
    const now = await linkOf(p);
    const attendees = await withTenant(sys(), (tx) =>
      tx.execute<{ id: string }>(
        sql`select a.id from attendees.attendees a join ticketing.tickets t on t.id = a.ticket_id where t.order_id = ${p.orderId}`,
      ),
    );
    const op = await executeCommand(
      ticketCancelBulk.start,
      { eventId: c.ev.id, selection: { ids: attendees.map((x) => x.id) }, params: {} },
      a.ctx(),
      ports,
    );
    expect(await runBulk(a.org.id, op.operationId)).toBe('done');
    expect(await calendarFeedTarget(now, SECRET)).toBeNull();
  });
});

describe('isolation and the entitlement (M5.10a)', () => {
  it('another org sees nothing and changes nothing, even with a real link', async () => {
    const c = await conference();
    const s = await session(c, 'Isolated', 1);
    const p = await registrant(c);
    await star(p, s.id);
    await expect(hub(p, b)).rejects.toMatchObject({ code: 'not_found' });
    await expect(star(p, s.id, 'refuse', b)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(rotateCalendarFeedCommand, { token: p.token, registrantId: p.id }, anon(b), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(calendarFeedQuery, { registrantId: p.id, version: 1 }, anon(b), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Org b's registrant can't star org a's session.
    const cb = await conference(b);
    const pb = await registrant(cb, [cb.fullPass], b);
    await expect(star(pb, s.id, 'refuse', b)).rejects.toMatchObject({ code: 'not_found' });
    // A forged registrant id (someone else's ticket) under a valid link is not found.
    const q = await registrant(c);
    await expect(
      executeCommand(
        favoriteSessionCommand,
        { token: p.token, registrantId: q.id, sessionId: s.id, favorite: true, choice: 'refuse' },
        anon(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // The hub shows only the chosen registrant's own favorites.
    expect((await hub(q)).sessions.find((x) => x.sessionId === s.id)?.favorite).toBe(false);
    for (const table of ['session_favorites', 'calendar_feeds']) {
      const rows = await withTenant(sys(b), (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.raw(`registration.${table}`)} where org_id = ${a.org.id}`,
        ),
      );
      expect(rows[0]?.n).toBe(0);
    }
  });

  it('a revoked registration module refuses the hub, favorites and the feed', async () => {
    const c = await conference();
    const s = await session(c, 'Gated', 1);
    const p = await registrant(c);
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'registration', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(hub(p)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(star(p, s.id)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(
        executeQuery(calendarFeedQuery, { registrantId: p.id, version: 1 }, anon(), ports),
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
