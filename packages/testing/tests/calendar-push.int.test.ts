import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import {
  beginConnectCommand,
  beginPersonalCalendarCommand,
  calendarEventId,
  completeConnectCommand,
  completePersonalCalendarCommand,
  connectionDetailQuery,
  disconnectCommand,
  type FakeAccount,
  failPersonalCalendarCommand,
  fakeCalendarAllEvents,
  fakeCalendarEvents,
  fakeIntegrations,
  googleCalendarFakeProvider,
  listConnectionsQuery,
  offeredConnectors,
  originStamp,
  pendingPersonalCalendarQuery,
  personalCalendarQuery,
  runSync,
  stopPersonalCalendarCommand,
  syncPersonalCalendarCommand,
  zonedDateTime,
} from '@yayatoh/integrations';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  createSessionCommand,
  deleteSessionCommand,
  setSessionAgendaCommand,
  updateSessionCommand,
} from '@yayatoh/program';
import {
  dropSessionCommand,
  enrollSessionCommand,
  registrantsOfLinkTx,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseNow, exportNow } from '../src/dsar/helpers.ts';
import { bareOrg, fakeAuth, type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.5c Google Calendar push on real Postgres with the fake `IntegrationAuth` and the fake Calendar
 * API: the org calendar (every placed session of live events) and personal schedules (a
 * registrant's opt-in from their manage link). A moved session updates every subscribed calendar
 * exactly once; a deleted session, or one of a cancelled event, comes off; a revoked connection
 * stops within one run; personal calendars carry only their registrant's sessions.
 */

const deps = { auth: fakeAuth };
const tag = uuidv7().slice(-8);
const H = 3_600_000;
const START = new Date('2030-03-09T15:00:00Z');
const at = (h: number) => new Date(START.getTime() + h * H);
let n = 0;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
}, 240_000);
afterAll(async () => {
  await closePools();
});

interface Org {
  orgId: string;
  ctx: () => Ctx;
}
const anon = (org: Org) => createCtx({ orgId: org.orgId });

interface Conf {
  ev: EventDto;
  member: string;
  fullPass: string;
  dayPass: string;
}

/** A published conference in New York with free Member cells for the full and the day pass. */
async function conference(org: Org): Promise<Conf> {
  n += 1;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Calendar ${tag} ${n}`,
      profile: 'conference',
      timezone: 'America/New_York',
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
  for (const key of ['full_pass', 'day_pass'])
    await executeCommand(
      setCellCommand,
      { eventId: ev.id, registrationTypeId: member, admissionItemId: item(key), priceMinor: 0 },
      org.ctx(),
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return { ev, member, fullPass: item('full_pass'), dayPass: item('day_pass') };
}

async function session(org: Org, c: Conf, title: string, h: number, admission: 'included' | 'optional') {
  const res = await executeCommand(
    createSessionCommand,
    { eventId: c.ev.id, title, startsAt: at(h), endsAt: at(h + 1), capacity: 50 },
    org.ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    { eventId: c.ev.id, sessionId: res.session.id, admission, groupId: null },
    org.ctx(),
    ports,
  );
  return res.session;
}

const move = (org: Org, c: Conf, s: { id: string; title: string }, h: number, title = s.title) =>
  executeCommand(
    updateSessionCommand,
    { eventId: c.ev.id, sessionId: s.id, title, startsAt: at(h), endsAt: at(h + 1), capacity: 50 },
    org.ctx(),
    ports,
  );

interface Person {
  token: string;
  id: string;
  email: string;
}
async function registrant(org: Org, c: Conf): Promise<Person> {
  n += 1;
  const email = `cal${tag}${n}@example.test`;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: c.ev.id,
      registrationTypeId: c.member,
      itemIds: [c.fullPass],
      buyer: { email, name: `Calendar Person ${n}` },
    },
    anon(org),
    ports,
  );
  const [reg] = await withTenant(systemCtx(org.orgId), (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  return { token: r.manageToken, id: reg.id, email };
}

/** The console's connect for the org calendar (begin, the fake consent's Allow, complete). */
async function connectOrgCalendar(org: Org) {
  const { connectionId, state } = await executeCommand(
    beginConnectCommand,
    { connector: 'google_calendar' },
    org.ctx(),
    ports,
  );
  fakeIntegrations.approve(
    { orgId: org.orgId, connectionId, providerConfigKey: 'google_calendar' },
    googleCalendarFakeProvider,
  );
  const resolved = await fakeAuth.resolve({
    orgId: org.orgId,
    connectionId,
    providerConfigKey: 'google_calendar',
  });
  if (!resolved) throw new Error('fake connect did not resolve');
  await executeCommand(
    completeConnectCommand,
    { connectionId, state, authConnectionId: resolved.authConnectionId, accountLabel: resolved.accountLabel },
    org.ctx(),
    ports,
  );
  return { connectionId, account: account(resolved.authConnectionId) };
}

/** The schedule page's opt-in: begin with the manage link, Allow, complete. */
async function connectPersonal(org: Org, p: Person) {
  const link = { token: p.token, registrantId: p.id };
  const { connectionId, state } = await executeCommand(beginPersonalCalendarCommand, link, anon(org), ports);
  fakeIntegrations.approve(
    { orgId: org.orgId, connectionId, providerConfigKey: 'google_calendar_personal' },
    googleCalendarFakeProvider,
  );
  expect(
    (await executeQuery(pendingPersonalCalendarQuery, { ...link, state }, anon(org), ports)).connectionId,
  ).toBe(connectionId);
  const resolved = await fakeAuth.resolve({
    orgId: org.orgId,
    connectionId,
    providerConfigKey: 'google_calendar_personal',
  });
  if (!resolved) throw new Error('fake connect did not resolve');
  await executeCommand(
    completePersonalCalendarCommand,
    { ...link, connectionId, state, authConnectionId: resolved.authConnectionId },
    anon(org),
    ports,
  );
  return { connectionId, account: account(resolved.authConnectionId) };
}

const account = (id: string): FakeAccount => {
  const acc = fakeIntegrations.account(id);
  if (!acc) throw new Error('no fake account');
  return acc;
};
const sync = (org: Org, connectionId: string) =>
  runSync(org.orgId, connectionId, deps, ports, { force: true });
const writes = (acc: FakeAccount) => acc.log.filter((l) => l.method !== 'GET');
const titles = (acc: FakeAccount) =>
  fakeCalendarEvents(acc)
    .map((e) => e.summary)
    .sort();
const expectError = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

describe('org calendar (M6.5c)', () => {
  it('pushes every placed session of live events, in the event time zone; a replay writes nothing', async () => {
    const org = await bareOrg(`cal-${tag}-1`, 'Calendar One');
    const c = await conference(org);
    await session(org, c, 'Opening keynote', 2, 'included');
    await session(org, c, 'Workshop', 4, 'optional');
    // A draft (an accepted proposal not yet placed) never reaches a calendar.
    const draft = await session(org, c, 'Draft talk', 6, 'optional');
    await withTenant(systemCtx(org.orgId), (tx) =>
      tx.execute(sql`update program.sessions set draft = true where id = ${draft.id}`),
    );
    const cal = await connectOrgCalendar(org);
    const first = await sync(org, cal.connectionId);
    expect(first.runStatus).toBe('succeeded');
    expect(titles(cal.account)).toEqual(['Opening keynote', 'Workshop']);
    const keynote = fakeCalendarEvents(cal.account).find((e) => e.summary === 'Opening keynote');
    // 17:00 UTC on 9 March 2030 is noon in New York (EST, the day before the DST change).
    expect(keynote?.start).toEqual({
      dateTime: zonedDateTime(at(2), 'America/New_York'),
      timeZone: 'America/New_York',
    });
    expect(keynote?.start.dateTime).toBe('2030-03-09T12:00:00-05:00');
    expect(keynote?.extendedProperties.private.yayatohOrigin).toBe(originStamp(cal.connectionId));
    const before = writes(cal.account).length;
    expect(before).toBe(2);
    const replay = await sync(org, cal.connectionId);
    expect(replay.runStatus).toBe('succeeded');
    expect(writes(cal.account)).toHaveLength(before);
    // The console lists the org calendar; its default interval is 15 minutes.
    const listed = await executeQuery(listConnectionsQuery, {}, org.ctx(), ports);
    expect(listed.find((x) => x.connector === 'google_calendar')?.syncIntervalMinutes).toBe(15);
  });

  it('a create whose answer was lost finds its entry instead of making a second one', async () => {
    const org = await bareOrg(`cal-${tag}-2`, 'Calendar Two');
    const c = await conference(org);
    const s = await session(org, c, 'Panel', 2, 'included');
    const cal = await connectOrgCalendar(org);
    await sync(org, cal.connectionId);
    // The link is lost (the commit after the provider call never happened).
    await withTenant(systemCtx(org.orgId), (tx) =>
      tx.execute(sql`delete from integrations.record_links where connection_id = ${cal.connectionId}`),
    );
    await move(org, c, s, 3);
    await sync(org, cal.connectionId);
    const all = fakeCalendarAllEvents(cal.account);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(calendarEventId(originStamp(cal.connectionId), s.id));
    expect(all[0]?.start.dateTime).toBe(zonedDateTime(at(3), 'America/New_York'));
  });
});

describe('a moved session updates every subscribed calendar exactly once (M6.5c)', () => {
  it('org calendar and two personal calendars: one PUT each, none on the next runs', async () => {
    const org = await bareOrg(`cal-${tag}-3`, 'Calendar Three');
    const c = await conference(org);
    const keynote = await session(org, c, 'Keynote', 2, 'included');
    await session(org, c, 'Lunch talk', 5, 'included');
    const [p1, p2] = [await registrant(org, c), await registrant(org, c)];
    const cal = await connectOrgCalendar(org);
    const one = await connectPersonal(org, p1);
    const two = await connectPersonal(org, p2);
    const calendars = [
      { id: cal.connectionId, acc: cal.account },
      { id: one.connectionId, acc: one.account },
      { id: two.connectionId, acc: two.account },
    ];
    for (const x of calendars) await sync(org, x.id);
    for (const x of calendars) expect(titles(x.acc)).toEqual(['Keynote', 'Lunch talk']);
    const before = calendars.map((x) => writes(x.acc).length);

    await move(org, c, keynote, 7);
    for (const x of calendars) await sync(org, x.id);
    for (const [i, x] of calendars.entries()) {
      const after = writes(x.acc).slice(before[i]);
      const id = calendarEventId(originStamp(x.id), keynote.id);
      expect(after).toEqual([
        {
          method: 'PUT',
          path: `/calendar/v3/calendars/primary/events/${id}`,
          idempotencyKey: expect.any(String),
        },
      ]);
      const entry = fakeCalendarEvents(x.acc).find((e) => e.id === id);
      expect(entry?.start.dateTime).toBe(zonedDateTime(at(7), 'America/New_York'));
      expect(entry?.writes).toBe(2);
    }
    // Runs again (and again): nothing new to write.
    const settled = calendars.map((x) => writes(x.acc).length);
    for (const x of calendars) {
      await sync(org, x.id);
      await sync(org, x.id);
    }
    expect(calendars.map((x) => writes(x.acc).length)).toEqual(settled);
    // A retried send of the same move carries the same key (applied once at the provider).
    const keys = calendars.map((x) => writes(x.acc).at(-1)?.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('removals (M6.5c)', () => {
  it('a deleted session comes off every calendar; a cancelled event takes all its sessions off', async () => {
    const org = await bareOrg(`cal-${tag}-4`, 'Calendar Four');
    const c = await conference(org);
    const gone = await session(org, c, 'To be cancelled', 2, 'included');
    await session(org, c, 'Stays', 3, 'included');
    const p = await registrant(org, c);
    const cal = await connectOrgCalendar(org);
    const mine = await connectPersonal(org, p);
    for (const id of [cal.connectionId, mine.connectionId]) await sync(org, id);
    await executeCommand(deleteSessionCommand, { eventId: c.ev.id, sessionId: gone.id }, org.ctx(), ports);
    for (const x of [cal, mine]) {
      const before = writes(x.account).length;
      await sync(org, x.connectionId);
      expect(titles(x.account)).toEqual(['Stays']);
      expect(
        writes(x.account)
          .slice(before)
          .map((w) => w.method),
      ).toEqual(['DELETE']);
      // Gone stays gone: the next run deletes nothing again.
      const settled = writes(x.account).length;
      await sync(org, x.connectionId);
      expect(writes(x.account)).toHaveLength(settled);
    }
    const [{ n: links } = { n: -1 }] = await withTenant(systemCtx(org.orgId), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from integrations.record_links where connection_id = ${cal.connectionId}`,
      ),
    );
    expect(links).toBe(1);

    await executeCommand(
      transitionEventCommand,
      { eventId: c.ev.id, transition: 'cancel' },
      org.ctx(),
      ports,
    ).catch(async () =>
      withTenant(systemCtx(org.orgId), (tx) =>
        tx.execute(sql`update events.events set status = 'cancelled' where id = ${c.ev.id}`),
      ),
    );
    await sync(org, cal.connectionId);
    expect(titles(cal.account)).toEqual([]);
  });
});

describe('erasure (batch 3l merge)', () => {
  it('erasing a registrant deletes their personal calendar connection and its links; others keep theirs', async () => {
    const org = await bareOrg(`cal-${tag}-erase`, 'Calendar Erase');
    const c = await conference(org);
    await session(org, c, 'Plenary', 2, 'included');
    const [p, q] = [await registrant(org, c), await registrant(org, c)];
    const mine = await connectPersonal(org, p);
    const theirs = await connectPersonal(org, q);
    await sync(org, mine.connectionId);
    await sync(org, theirs.connectionId);
    const links = (connectionId: string) =>
      withTenant(systemCtx(org.orgId), async (tx) => {
        const r = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from integrations.record_links where connection_id = ${connectionId}`,
        );
        return r[0]?.n ?? 0;
      });
    const exists = (connectionId: string) =>
      withTenant(systemCtx(org.orgId), async (tx) => {
        const r = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from integrations.connections where id = ${connectionId}`,
        );
        return (r[0]?.n ?? 0) > 0;
      });
    expect(await links(mine.connectionId)).toBe(1);
    const { modules } = await exportNow(p.email, org.ctx());
    expect(modules.integrations).toMatchObject({
      personalConnections: [{ connector: 'google_calendar_personal' }],
    });
    const r = await eraseNow(p.email, org.ctx());
    expect(r).toBeTruthy();
    expect(await exists(mine.connectionId)).toBe(false);
    expect(await links(mine.connectionId)).toBe(0);
    expect(await exists(theirs.connectionId)).toBe(true);
    expect(await links(theirs.connectionId)).toBe(1);
  });
});

describe('personal schedules (M6.5c)', () => {
  it('carry only the registrant’s sessions: included ones, and optional ones while enrolled', async () => {
    const org = await bareOrg(`cal-${tag}-5`, 'Calendar Five');
    const c = await conference(org);
    await session(org, c, 'Plenary', 2, 'included');
    const workshop = await session(org, c, 'Hands-on lab', 4, 'optional');
    const p = await registrant(org, c);
    const other = await registrant(org, c);
    const mine = await connectPersonal(org, p);
    const link = { token: p.token, registrantId: p.id };
    expect((await executeQuery(personalCalendarQuery, link, anon(org), ports)).state).toBe('active');
    await sync(org, mine.connectionId);
    expect(titles(mine.account)).toEqual(['Plenary']);
    // The other registrant enrolls: nothing changes on this calendar.
    await executeCommand(
      enrollSessionCommand,
      { token: other.token, registrantId: other.id, sessionId: workshop.id, choice: 'refuse' },
      createCtx({ orgId: org.orgId, now: at(-72) }),
      ports,
    );
    await sync(org, mine.connectionId);
    expect(titles(mine.account)).toEqual(['Plenary']);
    // They enroll: on the next run it is on their calendar; they drop it: it comes off.
    await executeCommand(
      enrollSessionCommand,
      { ...link, sessionId: workshop.id, choice: 'refuse' },
      createCtx({ orgId: org.orgId, now: at(-72) }),
      ports,
    );
    await executeCommand(syncPersonalCalendarCommand, link, anon(org), ports);
    await runSync(org.orgId, mine.connectionId, deps, ports);
    expect(titles(mine.account)).toEqual(['Hands-on lab', 'Plenary']);
    const status = await executeQuery(personalCalendarQuery, link, anon(org), ports);
    expect(status).toMatchObject({
      state: 'active',
      entries: 2,
      lastSyncStatus: 'succeeded',
      syncing: false,
    });
    await executeCommand(
      dropSessionCommand,
      { ...link, sessionId: workshop.id },
      createCtx({ orgId: org.orgId, now: at(-72) }),
      ports,
    );
    await sync(org, mine.connectionId);
    expect(titles(mine.account)).toEqual(['Plenary']);
  });

  it('the manage link is the credential: another order’s link, another registrant or another org is not found', async () => {
    const org = await bareOrg(`cal-${tag}-6`, 'Calendar Six');
    const c = await conference(org);
    const p = await registrant(org, c);
    const q = await registrant(org, c);
    await expectError(
      executeCommand(beginPersonalCalendarCommand, { token: q.token, registrantId: p.id }, anon(org), ports),
      'not_found',
    );
    await expectError(
      executeQuery(
        personalCalendarQuery,
        { token: p.token, registrantId: p.id },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
      'not_found',
    );
    // Off until they opt in; a refused consent leaves it off.
    const link = { token: p.token, registrantId: p.id };
    expect((await executeQuery(personalCalendarQuery, link, anon(org), ports)).state).toBe('off');
    const begun = await executeCommand(beginPersonalCalendarCommand, link, anon(org), ports);
    expect((await executeQuery(personalCalendarQuery, link, anon(org), ports)).state).toBe('pending');
    await executeCommand(
      failPersonalCalendarCommand,
      { ...link, connectionId: begun.connectionId },
      anon(org),
      ports,
    );
    expect((await executeQuery(personalCalendarQuery, link, anon(org), ports)).state).toBe('off');
    // A wrong state never completes.
    const again = await executeCommand(beginPersonalCalendarCommand, link, anon(org), ports);
    await expectError(
      executeCommand(
        completePersonalCalendarCommand,
        { ...link, connectionId: again.connectionId, state: 'x'.repeat(32), authConnectionId: 'fake_x' },
        anon(org),
        ports,
      ),
      'not_found',
    );
  });

  it('personal connections are never the console’s: not listed, not offered, not connectable there', async () => {
    const org = await bareOrg(`cal-${tag}-7`, 'Calendar Seven');
    const c = await conference(org);
    const p = await registrant(org, c);
    const mine = await connectPersonal(org, p);
    expect(offeredConnectors('fake').map((x) => x.key)).not.toContain('google_calendar_personal');
    expect(offeredConnectors('nango').map((x) => x.key)).toContain('google_calendar');
    const listed = await executeQuery(listConnectionsQuery, {}, org.ctx(), ports);
    expect(listed.map((x) => x.connector)).not.toContain('google_calendar_personal');
    await expectError(
      executeQuery(connectionDetailQuery, { connectionId: mine.connectionId }, org.ctx(), ports),
      'not_found',
    );
    await expectError(
      executeCommand(beginConnectCommand, { connector: 'google_calendar_personal' }, org.ctx(), ports),
      'not_found',
    );
    // Another org cannot see it at all (RLS).
    const [{ n: seen } = { n: -1 }] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from integrations.connections where id = ${mine.connectionId}`,
      ),
    );
    expect(seen).toBe(0);
  });
});

describe('revocation (M6.5c)', () => {
  it('a connection revoked at Google stops updates within one run', async () => {
    const org = await bareOrg(`cal-${tag}-8`, 'Calendar Eight');
    const c = await conference(org);
    const s = await session(org, c, 'Revoked talk', 2, 'included');
    const cal = await connectOrgCalendar(org);
    await sync(org, cal.connectionId);
    fakeIntegrations.revokeAtProvider(cal.account.authConnectionId);
    await move(org, c, s, 5);
    const before = writes(cal.account).length;
    const run = await sync(org, cal.connectionId);
    expect(run).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    expect(writes(cal.account)).toHaveLength(before);
    expect((await sync(org, cal.connectionId)).status).toBe('inactive');
    expect(fakeCalendarEvents(cal.account)[0]?.start.dateTime).toBe(zonedDateTime(at(2), 'America/New_York'));
  });

  it('disconnecting (org) or stopping (personal) here stops updates at once', async () => {
    const org = await bareOrg(`cal-${tag}-9`, 'Calendar Nine');
    const c = await conference(org);
    const s = await session(org, c, 'Stopped talk', 2, 'included');
    const p = await registrant(org, c);
    const cal = await connectOrgCalendar(org);
    const mine = await connectPersonal(org, p);
    for (const id of [cal.connectionId, mine.connectionId]) await sync(org, id);
    await executeCommand(disconnectCommand, { connectionId: cal.connectionId }, org.ctx(), ports);
    const stopped = await executeCommand(
      stopPersonalCalendarCommand,
      { token: p.token, registrantId: p.id },
      anon(org),
      ports,
    );
    expect(stopped).toMatchObject({
      connectionId: mine.connectionId,
      providerConfigKey: 'google_calendar_personal',
    });
    await move(org, c, s, 6);
    const before = [writes(cal.account).length, writes(mine.account).length];
    expect((await sync(org, cal.connectionId)).status).toBe('inactive');
    expect((await sync(org, mine.connectionId)).status).toBe('inactive');
    expect([writes(cal.account).length, writes(mine.account).length]).toEqual(before);
    expect(
      (await executeQuery(personalCalendarQuery, { token: p.token, registrantId: p.id }, anon(org), ports))
        .state,
    ).toBe('revoked');
    // They can opt in again.
    const again = await executeCommand(
      beginPersonalCalendarCommand,
      { token: p.token, registrantId: p.id },
      anon(org),
      ports,
    );
    expect(again.connectionId).not.toBe(mine.connectionId);
  });
});

describe('entitlement and permissions (M6.5c)', () => {
  it('needs the integrations module; the org calendar needs integrations:manage', async () => {
    const org = await bareOrg(`cal-${tag}-10`, 'Calendar Ten');
    const c = await conference(org);
    const p = await registrant(org, c);
    await expectError(
      executeCommand(
        beginConnectCommand,
        { connector: 'google_calendar' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'integrations', effect: 'revoke', reason: 'test' },
      systemCtx(org.orgId),
      ports,
    );
    await expectError(
      executeCommand(beginPersonalCalendarCommand, { token: p.token, registrantId: p.id }, anon(org), ports),
      'module_not_enabled',
    );
    await expectError(
      executeCommand(beginConnectCommand, { connector: 'google_calendar' }, org.ctx(), ports),
      'module_not_enabled',
    );
  });
});
