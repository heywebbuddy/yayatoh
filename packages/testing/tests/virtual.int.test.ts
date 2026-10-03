import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { listCheckpointsQuery, virtualAttendanceSubscriber, virtualCheckpointsQuery } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { setEventDetailsCommand } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { consumeEvent } from '@yayatoh/platform';
import { createSessionCommand } from '@yayatoh/program';
import {
  createStreamCommand,
  fakePlaybackCheck,
  heartbeatCommand,
  MINUTE_MS,
  PLAYBACK_TTL_MS,
  revealStreamKeyCommand,
  setStreamEnabledCommand,
  setTicketAccessCommand,
  startPlaybackCommand,
  streamingUsageQuery,
  viewerQuery,
  virtualSetupQuery,
  virtualTicketToken,
} from '@yayatoh/virtual';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, systemCtx, twoOrgs, userCtx } from '../src/fixtures.ts';
import { ports, videoProvider } from '../src/ports.ts';

/**
 * M6.9a virtual v1: delivery and access modes, signed playback per attendee and session,
 * once-per-minute watch time, and the virtual checkpoint. Real Postgres, the fake video provider.
 */
let a: OrgFixture;
let b: OrgFixture;

interface Seats {
  readonly sessions: string[];
  readonly tickets: { id: string; typeId: string }[];
}
let seats: Seats;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  // The fixture streams its first session already; these tests use two sessions of their own.
  const sessions: { session: { id: string } }[] = [];
  for (const n of [1, 2])
    sessions.push(
      await executeCommand(
        createSessionCommand,
        {
          eventId: a.event.id,
          title: `Virtual talk ${n}`,
          startsAt: new Date(a.event.startsAt.getTime() + n * 3_600_000),
          endsAt: new Date(a.event.startsAt.getTime() + (n + 1) * 3_600_000),
        },
        a.ctx(),
        ports,
      ),
    );
  seats = await withTenant(systemCtx(a.org.id), async (tx) => {
    const tickets = await tx.execute<{ id: string; ticket_type_id: string }>(
      sql`select id, ticket_type_id from ticketing.tickets where event_id = ${a.event.id} and status = 'active'
          order by created_at, id`,
    );
    return {
      sessions: sessions.map((s) => s.session.id),
      tickets: tickets.map((t) => ({ id: t.id, typeId: t.ticket_type_id })),
    };
  });
  if (seats.sessions.length < 2 || seats.tickets.length < 2)
    throw new Error('fixture: need two sessions without streams and two tickets');
  await setMode(a, 'hybrid');
}, 240_000);

afterAll(async () => {
  await closePools();
});

const setMode = (o: OrgFixture, attendanceMode: 'in_person' | 'online' | 'hybrid') =>
  executeCommand(setEventDetailsCommand, { eventId: o.event.id, attendanceMode }, o.ctx(), ports);

const expectError = async (p: Promise<unknown>, code: string, reason?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (reason) expect((err as DomainError).details?.reason).toBe(reason);
};

/** The public (anonymous) context of an org, at a given time. */
const publicCtx = (orgId: string, now = new Date()) => createCtx({ orgId, now });
const viewerCtx = () => userCtx(a.viewerId, a.org.id);

const S1 = () => seats.sessions[0] as string;
const S2 = () => seats.sessions[1] as string;
const T1 = () => seats.tickets[0] as { id: string; typeId: string };
const T2 = () => seats.tickets[1] as { id: string; typeId: string };

async function stream(sessionId: string) {
  return executeCommand(createStreamCommand, { eventId: a.event.id, sessionId }, a.ctx(), ports);
}
const access = (ticketTypeId: string, mode: 'in_person' | 'virtual' | 'both') =>
  executeCommand(setTicketAccessCommand, { eventId: a.event.id, ticketTypeId, access: mode }, a.ctx(), ports);
const start = (ticketId: string, sessionId: string, now = new Date()) =>
  executeCommand(
    startPlaybackCommand,
    { eventId: a.event.id, sessionId, ticketToken: virtualTicketToken(ticketId) },
    publicCtx(a.org.id, now),
    ports,
  );
const beat = (token: string, seq: number, now: Date, orgId = a.org.id) =>
  executeCommand(heartbeatCommand, { token, seq }, publicCtx(orgId, now), ports);

const minutesOf = (ticketId: string, sessionId?: string) =>
  withTenant(systemCtx(a.org.id), async (tx) => {
    const [r] = await tx.execute<{ n: number }>(
      sessionId
        ? sql`select count(*)::int as n from virtual.watch_minutes where ticket_id = ${ticketId} and session_id = ${sessionId}`
        : sql`select count(*)::int as n from virtual.watch_minutes where ticket_id = ${ticketId}`,
    );
    return r?.n ?? 0;
  });

const attendedEvents = (ticketId: string) =>
  withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{
      id: string;
      type: string;
      version: number;
      aggregate_type: string;
      aggregate_id: string;
      payload: unknown;
    }>(
      sql`select id, type, version, aggregate_type, aggregate_id, payload from platform.domain_events
          where type = 'virtual.attended' and payload->>'ticketId' = ${ticketId} order by id`,
    ),
  );

/** A fresh minute boundary in the future, so tests never share a minute with the fixture's. */
let clock = Math.ceil(Date.now() / MINUTE_MS) * MINUTE_MS + 10 * MINUTE_MS;
const nextMinute = () => {
  clock += 2 * MINUTE_MS;
  return clock;
};

describe('delivery and access modes', () => {
  it('defaults follow the delivery mode; an organizer choice wins; in-person events never stream', async () => {
    await setMode(a, 'online');
    let setup = await executeQuery(virtualSetupQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(setup.deliveryMode).toBe('online');
    expect(setup.provider).toBe('fake');
    const untouched = setup.ticketTypes.find((t) => t.access === null);
    if (untouched) expect(untouched.effective).toBe('virtual');
    await setMode(a, 'in_person');
    setup = await executeQuery(virtualSetupQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(setup.ticketTypes.every((t) => t.effective === 'in_person')).toBe(true);
    await expectError(stream(S1()), 'invalid_state', 'in_person_event');
    await setMode(a, 'hybrid');
    const row = await access(T1().typeId, 'both');
    expect(row).toMatchObject({ ticketTypeId: T1().typeId, access: 'both', effective: 'both' });
  });

  it('organizer writes need events:write; a viewer reads only; another org sees nothing', async () => {
    await expectError(
      executeCommand(
        setTicketAccessCommand,
        { eventId: a.event.id, ticketTypeId: T1().typeId, access: 'virtual' },
        viewerCtx(),
        ports,
      ),
      'forbidden',
    );
    await expectError(
      executeCommand(createStreamCommand, { eventId: a.event.id, sessionId: S1() }, viewerCtx(), ports),
      'forbidden',
    );
    const seen = await executeQuery(virtualSetupQuery, { eventId: a.event.id }, viewerCtx(), ports);
    expect(seen.eventId).toBe(a.event.id);
    // Org b cannot reach org a's event, ticket types or streams.
    await expectError(executeQuery(virtualSetupQuery, { eventId: a.event.id }, b.ctx(), ports), 'not_found');
    await expectError(
      executeCommand(
        setTicketAccessCommand,
        { eventId: b.event.id, ticketTypeId: T1().typeId, access: 'virtual' },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
  });

  it('streams: one per session (idempotent), the key comes from the provider and is never stored', async () => {
    const first = await stream(S1());
    const again = await stream(S1());
    expect(again.stream.id).toBe(first.stream.id);
    expect(first.stream).toMatchObject({ provider: 'fake', enabled: true });
    const key = await executeCommand(
      revealStreamKeyCommand,
      { eventId: a.event.id, sessionId: S1() },
      a.ctx(),
      ports,
    );
    expect(key.streamKey).toMatch(/^fake-sk-/);
    await expectError(
      executeCommand(revealStreamKeyCommand, { eventId: a.event.id, sessionId: S1() }, viewerCtx(), ports),
      'forbidden',
    );
    const stored = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ row: string }>(
        sql`select to_jsonb(s)::text as row from virtual.streams s where session_id = ${S1()}`,
      ),
    );
    expect(stored[0]?.row).not.toContain(key.streamKey);
    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'virtual.stream.key_revealed'`,
      ),
    );
    expect(audit[0]?.n).toBeGreaterThan(0);
  });

  it('without the virtual module nothing reads or writes', async () => {
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'virtual', effect: 'revoke', reason: 'test' },
      systemCtx(b.org.id),
      ports,
    );
    await expectError(
      executeQuery(virtualSetupQuery, { eventId: b.event.id }, b.ctx(), ports),
      'module_not_enabled',
    );
    await expectError(
      executeCommand(
        startPlaybackCommand,
        { eventId: b.event.id, sessionId: S1(), ticketToken: virtualTicketToken(T1().id) },
        publicCtx(b.org.id),
        ports,
      ),
      'module_not_enabled',
    );
    await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute(sql`delete from billing.entitlement_overrides where module_key = 'virtual'`),
    );
  });
});

describe('playback tokens', () => {
  it('an in-person-only ticket never gets a playback token', async () => {
    await stream(S1());
    const inPerson = T2();
    await access(inPerson.typeId, 'in_person');
    await expectError(start(inPerson.id, S1()), 'forbidden', 'in_person_only');
    const page = await executeQuery(
      viewerQuery,
      { eventId: a.event.id, ticketToken: virtualTicketToken(inPerson.id) },
      publicCtx(a.org.id),
      ports,
    );
    expect(page.access).toBe('in_person');
    expect(page.sessions).toEqual([]);
    // Hybrid default (no choice) is in person too.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`delete from virtual.ticket_access where ticket_type_id = ${inPerson.typeId}`),
    );
    await expectError(start(inPerson.id, S1()), 'forbidden', 'in_person_only');
    await access(inPerson.typeId, 'both');
  });

  it('works only for its attendee and session, and expires', async () => {
    await access(T1().typeId, 'both');
    await access(T2().typeId, 'both');
    await stream(S1());
    await stream(S2());
    const t0 = nextMinute();
    const p1 = await start(T1().id, S1(), new Date(t0));
    const s1 = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ session_id: string; playback_id: string }>(
        sql`select session_id, playback_id from virtual.streams where session_id in (${S1()}, ${S2()})`,
      ),
    );
    const pb = new Map(s1.map((r) => [r.session_id, r.playback_id]));
    // The CDN plays this session's stream with it, not another session's.
    expect(fakePlaybackCheck(videoProvider, pb.get(S1()) ?? '', p1.token, new Date(t0))).toBe('ok');
    expect(fakePlaybackCheck(videoProvider, pb.get(S2()) ?? '', p1.token, new Date(t0))).toBe('forbidden');
    expect(p1.expiresAt.getTime()).toBe(t0 + PLAYBACK_TTL_MS);
    // A heartbeat with T1's token counts for T1 in S1 only.
    const before2 = await minutesOf(T2().id);
    const beforeS2 = await minutesOf(T1().id, S2());
    expect((await beat(p1.token, 1, new Date(t0 + 1000))).counted).toBe(true);
    expect(await minutesOf(T1().id, S1())).toBeGreaterThan(0);
    expect(await minutesOf(T2().id)).toBe(before2);
    expect(await minutesOf(T1().id, S2())).toBe(beforeS2);
    // Another org's context, an expired token, a forged one: refused.
    await expectError(beat(p1.token, 2, new Date(t0 + 2000), b.org.id), 'forbidden', 'invalid_token');
    await expectError(beat(p1.token, 3, new Date(t0 + PLAYBACK_TTL_MS)), 'forbidden', 'invalid_token');
    expect(
      fakePlaybackCheck(videoProvider, pb.get(S1()) ?? '', p1.token, new Date(t0 + PLAYBACK_TTL_MS)),
    ).toBe('forbidden');
    const forged = `${p1.token.slice(0, -4)}AAAA`;
    await expectError(beat(forged, 4, new Date(t0 + 3000)), 'forbidden', 'invalid_token');
    // A forged or other-event watch link finds nothing.
    await expectError(
      executeCommand(
        startPlaybackCommand,
        { eventId: a.event.id, sessionId: S1(), ticketToken: `${T1().id}~forged` },
        publicCtx(a.org.id),
        ports,
      ),
      'not_found',
    );
    await expectError(
      executeCommand(
        startPlaybackCommand,
        { eventId: b.event.id, sessionId: S1(), ticketToken: virtualTicketToken(T1().id) },
        publicCtx(b.org.id),
        ports,
      ),
      'not_found',
    );
  });

  it('a switched-off stream issues no tokens and counts no heartbeats; a void ticket stops', async () => {
    await access(T1().typeId, 'both');
    await stream(S2());
    const t0 = nextMinute();
    const p = await start(T1().id, S2(), new Date(t0));
    await executeCommand(
      setStreamEnabledCommand,
      { eventId: a.event.id, sessionId: S2(), enabled: false },
      a.ctx(),
      ports,
    );
    await expectError(start(T1().id, S2(), new Date(t0)), 'not_found');
    await expectError(beat(p.token, 1, new Date(t0 + 1000)), 'invalid_state', 'stream_off');
    await executeCommand(
      setStreamEnabledCommand,
      { eventId: a.event.id, sessionId: S2(), enabled: true },
      a.ctx(),
      ports,
    );
    expect((await beat(p.token, 2, new Date(t0 + 2000))).reason).toMatch(/counted|same_minute/);
    // Taking virtual access away stops the count.
    await access(T1().typeId, 'in_person');
    await expectError(beat(p.token, 3, new Date(t0 + MINUTE_MS + 1000)), 'forbidden', 'in_person_only');
    await access(T1().typeId, 'both');
  });
});

describe('watch time', () => {
  it('counts once per minute: duplicates, other tabs and replayed heartbeats are ignored', async () => {
    await access(T2().typeId, 'both');
    await stream(S2());
    const t0 = nextMinute();
    const before = await minutesOf(T2().id, S2());
    const tab1 = await start(T2().id, S2(), new Date(t0));
    const tab2 = await start(T2().id, S2(), new Date(t0));
    const r1 = await beat(tab1.token, 1, new Date(t0 + 5_000));
    expect(r1).toMatchObject({ counted: true, reason: 'counted' });
    // The same minute again (a later beat, another tab): nothing more.
    expect(await beat(tab1.token, 2, new Date(t0 + 35_000))).toMatchObject({
      counted: false,
      reason: 'same_minute',
    });
    expect(await beat(tab2.token, 1, new Date(t0 + 40_000))).toMatchObject({
      counted: false,
      reason: 'same_minute',
    });
    // A replayed heartbeat (old sequence) in the next minute counts nothing.
    expect(await beat(tab1.token, 2, new Date(t0 + MINUTE_MS + 5_000))).toMatchObject({
      counted: false,
      reason: 'replayed',
    });
    expect(await beat(tab1.token, 1, new Date(t0 + MINUTE_MS + 6_000))).toMatchObject({ reason: 'replayed' });
    // The next sequence in the next minute counts.
    expect(await beat(tab1.token, 3, new Date(t0 + MINUTE_MS + 7_000))).toMatchObject({ counted: true });
    // Concurrent heartbeats in one minute still count once.
    const t1 = t0 + 2 * MINUTE_MS + 1_000;
    const results = await Promise.allSettled([
      beat(tab1.token, 4, new Date(t1)),
      beat(tab2.token, 2, new Date(t1)),
      beat(tab1.token, 5, new Date(t1 + 10)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled' && r.value.counted)).toHaveLength(1);
    expect(await minutesOf(T2().id, S2())).toBe(before + 3);
  });

  it('feeds the virtual checkpoint once per ticket and session', async () => {
    await access(T1().typeId, 'both');
    await stream(S1());
    const t0 = nextMinute();
    const p = await start(T1().id, S1(), new Date(t0));
    await beat(p.token, 1, new Date(t0 + 1_000));
    await beat(p.token, 2, new Date(t0 + MINUTE_MS + 1_000));
    const events = await attendedEvents(T1().id);
    const forS1 = events.filter((e) => (e.payload as { sessionId: string }).sessionId === S1());
    expect(forS1).toHaveLength(1);
    const e = forS1[0];
    if (!e) throw new Error('no event');
    expect(Object.keys(e.payload as object).sort()).toEqual([
      'at',
      'eventId',
      'orgId',
      'sessionId',
      'ticketId',
    ]);
    const published = {
      id: e.id,
      orgId: a.org.id,
      type: e.type,
      version: e.version,
      aggregateType: e.aggregate_type,
      aggregateId: e.aggregate_id,
      payload: e.payload,
      logSeq: 0,
    };
    await consumeEvent(virtualAttendanceSubscriber(), published);
    await consumeEvent(virtualAttendanceSubscriber(), { ...published, id: `${e.id.slice(0, -4)}ffff` });
    const cps = await executeQuery(virtualCheckpointsQuery, { eventId: a.event.id }, a.ctx(), ports);
    const cp = cps.find((c) => c.sessionId === S1());
    expect(cp?.checkedIn).toBe(1);
    expect(cp?.name).toMatch(/^Online · /);
    // Never offered to scanners.
    const listed = await executeQuery(listCheckpointsQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(listed.some((c) => c.id === cp?.checkpointId)).toBe(false);
    // The setup page sees the totals, never who.
    const setup = await executeQuery(virtualSetupQuery, { eventId: a.event.id }, a.ctx(), ports);
    const row = setup.sessions.find((s) => s.sessionId === S1());
    expect(row?.viewers).toBeGreaterThanOrEqual(1);
    expect(row?.minutes).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(setup)).not.toContain(T1().id);
  });

  it('the streaming meter sums viewer-minutes per period', async () => {
    const from = new Date(Date.now() - 24 * 3_600_000);
    const to = new Date(clock + 60 * MINUTE_MS);
    const usage = await executeQuery(streamingUsageQuery, { from, to }, a.ctx(), ports);
    const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from virtual.watch_minutes where minute >= ${from.toISOString()}::timestamptz and minute < ${to.toISOString()}::timestamptz`,
      ),
    );
    expect(usage.viewerMinutes).toBe(r?.n);
    expect(usage.viewers).toBeGreaterThanOrEqual(2);
  });
});

describe('viewer page', () => {
  it('lists streamed sessions with this ticket’s minutes only', async () => {
    await access(T1().typeId, 'both');
    const page = await executeQuery(
      viewerQuery,
      { eventId: a.event.id, ticketToken: virtualTicketToken(T1().id) },
      publicCtx(a.org.id),
      ports,
    );
    expect(page.access).toBe('both');
    expect(page.sessions.map((s) => s.sessionId)).toEqual(expect.arrayContaining([S1(), S2()]));
    expect(page.sessions.find((s) => s.sessionId === S1())?.minutes).toBe(await minutesOf(T1().id, S1()));
    expect(Object.keys(page).sort()).toEqual(['access', 'eventName', 'holderName', 'sessions', 'timezone']);
  });

  it('a void ticket’s link stops working', async () => {
    const ctx: Ctx = systemCtx(a.org.id);
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`update ticketing.tickets set status = 'void', void_reason = 'test' where id = ${T2().id}`,
      ),
    );
    await expectError(
      executeQuery(
        viewerQuery,
        { eventId: a.event.id, ticketToken: virtualTicketToken(T2().id) },
        publicCtx(a.org.id),
        ports,
      ),
      'not_found',
    );
    await expectError(start(T2().id, S1()), 'not_found');
  });
});
