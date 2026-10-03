import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { setEventDetailsCommand } from '@yayatoh/events';
import {
  createZoomWebinar,
  fakeIntegrations,
  recordCreatedZoomWebinarCommand,
  zoomFakeWebinar,
} from '@yayatoh/integrations';
import { createCtx, DomainError, executeCommand, executeQuery } from '@yayatoh/kernel';
import { createSessionCommand } from '@yayatoh/program';
import {
  createStreamCommand,
  FAKE_BACKUP_INGEST_URL,
  FAKE_CLOUDFLARE_BACKUP_INGEST_URL,
  FAKE_CLOUDFLARE_INGEST_URL,
  FAKE_INGEST_URL,
  fakePlaybackCheck,
  heartbeatCommand,
  linkZoomWebinarCommand,
  MINUTE_MS,
  processZoomWebhook,
  recordZoomAttendanceTx,
  recordZoomParticipantCommand,
  revealStreamKeyCommand,
  setActiveIngestCommand,
  setStreamEnabledCommand,
  setTicketAccessCommand,
  signZoomWebhook,
  startPlaybackCommand,
  streamingUsageQuery,
  switchStreamProviderCommand,
  viewerQuery,
  virtualSetupQuery,
  virtualTicketToken,
  zoomSetupQuery,
} from '@yayatoh/virtual';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, systemCtx, twoOrgs, userCtx } from '../src/fixtures.ts';
import { connectZoom, fakeAuth } from '../src/integrations.ts';
import { cloudflareVideoProvider, ports, videoProvider } from '../src/ports.ts';

/**
 * M6.10a virtual v2: switching a session's provider (Mux fake ↔ Cloudflare Stream fake) keeps
 * the ticket's grant and its watch-time history; RTMP overflow (backup ingest); creating Zoom
 * webinars through the org's Zoom connection (fake); Zoom join/leave webhooks verified on the raw
 * body before anything is read, and counted once however often they are replayed.
 */
let a: OrgFixture;
let b: OrgFixture;
let sessions: string[];
let tickets: { id: string; typeId: string; email: string }[];

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const made: string[] = [];
  for (const n of [1, 2, 3])
    made.push(
      (
        await executeCommand(
          createSessionCommand,
          {
            eventId: a.event.id,
            title: `Hybrid talk ${n}`,
            startsAt: new Date(Date.now() - 10 * MINUTE_MS + n),
            endsAt: new Date(Date.now() + 50 * MINUTE_MS),
          },
          a.ctx(),
          ports,
        )
      ).session.id,
    );
  sessions = made;
  tickets = await withTenant(systemCtx(a.org.id), async (tx) =>
    (
      await tx.execute<{ id: string; ticket_type_id: string; email: string }>(
        sql`select id, ticket_type_id, lower(holder_email) as email from ticketing.tickets
            where event_id = ${a.event.id} and status = 'active' order by created_at, id`,
      )
    ).map((t) => ({ id: t.id, typeId: t.ticket_type_id, email: t.email })),
  );
  if (tickets.length < 1) throw new Error('fixture: need a ticket');
  await executeCommand(
    setEventDetailsCommand,
    { eventId: a.event.id, attendanceMode: 'hybrid' },
    a.ctx(),
    ports,
  );
  for (const typeId of new Set(tickets.map((t) => t.typeId)))
    await executeCommand(
      setTicketAccessCommand,
      { eventId: a.event.id, ticketTypeId: typeId, access: 'both' },
      a.ctx(),
      ports,
    );
}, 240_000);

afterAll(async () => {
  await closePools();
});

const expectError = async (p: Promise<unknown>, code: string, reason?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (reason) expect((err as DomainError).details?.reason).toBe(reason);
};

const publicCtx = (orgId: string, now = new Date()) => createCtx({ orgId, now });
const T1 = () => tickets[0] as { id: string; typeId: string; email: string };
const S = (i: number) => sessions[i] as string;

const start = (sessionId: string, now = new Date()) =>
  executeCommand(
    startPlaybackCommand,
    { eventId: a.event.id, sessionId, ticketToken: virtualTicketToken(T1().id) },
    publicCtx(a.org.id, now),
    ports,
  );
const beat = (token: string, seq: number, now: Date) =>
  executeCommand(heartbeatCommand, { token, seq }, publicCtx(a.org.id, now), ports);

const rows = <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
  withTenant(systemCtx(a.org.id), (tx) => tx.execute<T>(q));

describe('switching a session’s video provider (M6.10a)', () => {
  it('keeps the stream, the grant and the watch-time history; old tokens are told to restart', async () => {
    const created = await executeCommand(
      createStreamCommand,
      { eventId: a.event.id, sessionId: S(0) },
      a.ctx(),
      ports,
    );
    expect(created.stream.provider).toBe('fake');
    expect(created.stream).toMatchObject({ hasBackup: true, activeIngest: 'primary' });
    const t0 = new Date();
    const first = await start(S(0), t0);
    expect(first).toMatchObject({ provider: 'fake', sandbox: true });
    expect((await beat(first.token, 1, t0)).counted).toBe(true);

    const switched = await executeCommand(
      switchStreamProviderCommand,
      { eventId: a.event.id, sessionId: S(0), provider: 'fake_cloudflare' },
      a.ctx(),
      ports,
    );
    expect(switched.switched).toBe(true);
    expect(switched.stream.id).toBe(created.stream.id);
    expect(switched.stream).toMatchObject({
      provider: 'fake_cloudflare',
      ingestUrl: FAKE_CLOUDFLARE_INGEST_URL,
      enabled: true,
      activeIngest: 'primary',
    });

    // The old provider's token is authentic but plays the old stream: the player must restart.
    const t1 = new Date(t0.getTime() + MINUTE_MS);
    await expectError(beat(first.token, 2, t1), 'invalid_state', 'provider_changed');

    // The ticket keeps its access: the watch page still lists the session, with its minute.
    const viewer = await executeQuery(
      viewerQuery,
      { eventId: a.event.id, ticketToken: virtualTicketToken(T1().id) },
      publicCtx(a.org.id),
      ports,
    );
    expect(viewer.sessions.find((s) => s.sessionId === S(0))?.minutes).toBe(1);

    const second = await start(S(0), t1);
    expect(second).toMatchObject({ provider: 'fake_cloudflare', sandbox: true });
    const [now] = await rows<{ playback_id: string }>(
      sql`select playback_id from virtual.streams where session_id = ${S(0)}`,
    );
    const playbackId = now?.playback_id as string;
    // Each fake CDN plays only its own tokens.
    expect(fakePlaybackCheck(cloudflareVideoProvider, playbackId, second.token, t1)).toBe('ok');
    expect(fakePlaybackCheck(videoProvider, playbackId, second.token, t1)).toBe('forbidden');
    const counted = await beat(second.token, 1, t1);
    expect(counted).toMatchObject({ counted: true, minutes: 2 });

    // History: both viewings kept, each minute stamped with the provider that served it.
    const minutes = await rows<{ provider: string }>(
      sql`select provider from virtual.watch_minutes where session_id = ${S(0)} and ticket_id = ${T1().id}
          order by minute`,
    );
    expect(minutes.map((m) => m.provider)).toEqual(['fake', 'fake_cloudflare']);
    const views = await rows<{ n: number }>(
      sql`select count(*)::int as n from virtual.views where session_id = ${S(0)}`,
    );
    expect(views[0]?.n).toBe(2);
    const usage = await executeQuery(
      streamingUsageQuery,
      { from: new Date(t0.getTime() - MINUTE_MS), to: new Date(t1.getTime() + MINUTE_MS) },
      a.ctx(),
      ports,
    );
    expect(usage.byProvider).toEqual(
      expect.arrayContaining([
        { provider: 'fake', viewerMinutes: expect.any(Number) },
        { provider: 'fake_cloudflare', viewerMinutes: expect.any(Number) },
      ]),
    );

    // The setup page lists both providers and the session's current one.
    const setup = await executeQuery(virtualSetupQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(setup.providers.map((p) => p.name)).toEqual(['fake', 'fake_cloudflare']);
    expect(setup.sessions.find((s) => s.sessionId === S(0))?.stream?.provider).toBe('fake_cloudflare');
  });

  it('switching to the same provider changes nothing; the stream’s off state is kept', async () => {
    await executeCommand(
      setStreamEnabledCommand,
      { eventId: a.event.id, sessionId: S(0), enabled: false },
      a.ctx(),
      ports,
    );
    const same = await executeCommand(
      switchStreamProviderCommand,
      { eventId: a.event.id, sessionId: S(0), provider: 'fake_cloudflare' },
      a.ctx(),
      ports,
    );
    expect(same.switched).toBe(false);
    const back = await executeCommand(
      switchStreamProviderCommand,
      { eventId: a.event.id, sessionId: S(0), provider: 'fake' },
      a.ctx(),
      ports,
    );
    expect(back.stream).toMatchObject({ provider: 'fake', enabled: false, ingestUrl: FAKE_INGEST_URL });
    await executeCommand(
      setStreamEnabledCommand,
      { eventId: a.event.id, sessionId: S(0), enabled: true },
      a.ctx(),
      ports,
    );
  });

  it('a new stream may start at the chosen provider', async () => {
    const r = await executeCommand(
      createStreamCommand,
      { eventId: a.event.id, sessionId: S(1), provider: 'fake_cloudflare' },
      a.ctx(),
      ports,
    );
    expect(r.stream.provider).toBe('fake_cloudflare');
    const key = await executeCommand(
      revealStreamKeyCommand,
      { eventId: a.event.id, sessionId: S(1) },
      a.ctx(),
      ports,
    );
    expect(key.streamKey).toMatch(/^fake-cf-sk-[0-9a-f]{32}$/);
  });

  it('refuses an unregistered provider, a viewer, another org and a session without a stream', async () => {
    await expectError(
      executeCommand(
        switchStreamProviderCommand,
        { eventId: a.event.id, sessionId: S(0), provider: 'mux' },
        a.ctx(),
        ports,
      ),
      'invalid_state',
      'provider_unavailable',
    );
    await expectError(
      executeCommand(
        createStreamCommand,
        { eventId: a.event.id, sessionId: S(2), provider: 'cloudflare' },
        a.ctx(),
        ports,
      ),
      'invalid_state',
      'provider_unavailable',
    );
    await expectError(
      executeCommand(
        switchStreamProviderCommand,
        { eventId: a.event.id, sessionId: S(0), provider: 'fake_cloudflare' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    await expectError(
      executeCommand(
        switchStreamProviderCommand,
        { eventId: a.event.id, sessionId: S(0), provider: 'fake_cloudflare' },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
    await expectError(
      executeCommand(
        switchStreamProviderCommand,
        { eventId: a.event.id, sessionId: S(2), provider: 'fake_cloudflare' },
        a.ctx(),
        ports,
      ),
      'not_found',
    );
  });
});

describe('RTMP overflow: the backup ingest (M6.10a)', () => {
  it('the organizer switches the encoder to the backup ingest and back; playback goes on', async () => {
    const key = (sessionId: string) =>
      executeCommand(revealStreamKeyCommand, { eventId: a.event.id, sessionId }, a.ctx(), ports);
    const before = await key(S(0));
    expect(before).toMatchObject({
      ingestUrl: FAKE_INGEST_URL,
      activeIngest: 'primary',
      backupIngestUrl: FAKE_BACKUP_INGEST_URL,
    });
    const t0 = new Date(Date.now() + 5 * MINUTE_MS);
    const view = await start(S(0), t0);
    const s = await executeCommand(
      setActiveIngestCommand,
      { eventId: a.event.id, sessionId: S(0), ingest: 'backup' },
      a.ctx(),
      ports,
    );
    expect(s.activeIngest).toBe('backup');
    const after = await key(S(0));
    expect(after).toMatchObject({ ingestUrl: FAKE_BACKUP_INGEST_URL, activeIngest: 'backup' });
    // Same stream key: the encoder only changes its server.
    expect(after.streamKey).toBe(before.streamKey);
    // Viewers are not interrupted: the same token keeps counting.
    expect((await beat(view.token, 1, t0)).counted).toBe(true);
    // The Cloudflare fake has its own backup.
    expect((await key(S(1))).backupIngestUrl).toBe(FAKE_CLOUDFLARE_BACKUP_INGEST_URL);
    await executeCommand(
      setActiveIngestCommand,
      { eventId: a.event.id, sessionId: S(0), ingest: 'primary' },
      a.ctx(),
      ports,
    );
    expect((await key(S(0))).ingestUrl).toBe(FAKE_INGEST_URL);
  });

  it('refuses a provider without a backup, a viewer and a missing stream', async () => {
    await rows(sql`update virtual.streams set backup_ingest_url = null where session_id = ${S(1)}`);
    await expectError(
      executeCommand(
        setActiveIngestCommand,
        { eventId: a.event.id, sessionId: S(1), ingest: 'backup' },
        a.ctx(),
        ports,
      ),
      'invalid_state',
      'no_backup_ingest',
    );
    await expectError(
      executeCommand(
        setActiveIngestCommand,
        { eventId: a.event.id, sessionId: S(0), ingest: 'backup' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    await expectError(
      executeCommand(
        setActiveIngestCommand,
        { eventId: a.event.id, sessionId: S(2), ingest: 'backup' },
        a.ctx(),
        ports,
      ),
      'not_found',
    );
  });
});

/* --------------------------------------------------------------------------- Zoom ---- */

const SECRET = 'zoom-webhook-test-secret-0123456789abcdef';
let webinarId = '';
let connectionId = '';

const joinBody = (p: {
  event: 'webinar.participant_joined' | 'webinar.participant_left';
  webinar: string;
  ts: number;
  email: string;
  participant: string;
  time: string;
}) =>
  JSON.stringify({
    event: p.event,
    event_ts: p.ts,
    payload: {
      account_id: 'acct_fake',
      object: {
        id: p.webinar,
        uuid: 'instance-1==',
        participant: {
          user_id: '16778240',
          user_name: 'Ticket Holder',
          participant_uuid: p.participant,
          email: p.email,
          ...(p.event === 'webinar.participant_joined' ? { join_time: p.time } : { leave_time: p.time }),
        },
      },
    },
  });

const deliver = (raw: string, at = new Date(), headers?: Record<string, string>) =>
  processZoomWebhook(raw, new Headers(headers ?? signZoomWebhook(SECRET, raw, at)), {
    secret: SECRET,
    ports,
    now: at,
  });

const countOf = async (q: ReturnType<typeof sql>) => (await rows<{ n: number }>(q))[0]?.n ?? 0;

describe('creating Zoom webinars from Yayatoh (M6.10a)', () => {
  it('creates the session’s webinar through the Zoom connection, once', async () => {
    ({ connectionId } = await connectZoom(a.ctx()));
    const r = await createZoomWebinar(a.ctx(), ports, fakeAuth, { eventId: a.event.id, sessionId: S(2) });
    expect(r.created).toBe(true);
    expect(r.webinarId).toMatch(/^[0-9]{11}$/);
    webinarId = r.webinarId as string;
    // Every holder with online access became a registrant.
    expect(r.added).toBeGreaterThanOrEqual(1);
    const account = fakeIntegrations.accountFor(connectionId);
    expect(account).not.toBeNull();
    const at = zoomFakeWebinar(account as NonNullable<typeof account>, webinarId);
    expect(at?.topic).toContain('Hybrid talk 3');
    expect(at?.duration).toBeGreaterThan(0);
    // A second call keeps the webinar (no second one at Zoom).
    const again = await createZoomWebinar(a.ctx(), ports, fakeAuth, { eventId: a.event.id, sessionId: S(2) });
    expect(again).toMatchObject({ created: false, webinarId });
    const setup = await executeQuery(zoomSetupQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(setup.sessions.find((s) => s.sessionId === S(2))).toMatchObject({ webinarId, created: true });
  });

  it('refuses without a Zoom connection, for a viewer, without the port, and a typed link is not “created”', async () => {
    await executeCommand(
      setEventDetailsCommand,
      { eventId: b.event.id, attendanceMode: 'online' },
      b.ctx(),
      ports,
    );
    const bSession = (
      await executeCommand(
        createSessionCommand,
        {
          eventId: b.event.id,
          title: 'B talk',
          startsAt: new Date(Date.now() + MINUTE_MS),
          endsAt: new Date(Date.now() + 60 * MINUTE_MS),
        },
        b.ctx(),
        ports,
      )
    ).session.id;
    await expectError(
      createZoomWebinar(b.ctx(), ports, fakeAuth, { eventId: b.event.id, sessionId: bSession }),
      'invalid_state',
      'zoom_not_connected',
    );
    await expectError(
      executeCommand(
        recordCreatedZoomWebinarCommand,
        { eventId: b.event.id, sessionId: bSession, webinarId: '89999999999' },
        b.ctx(),
        ports,
      ),
      'invalid_state',
      'zoom_not_connected',
    );
    await expectError(
      createZoomWebinar(b.ctx(), ports, null, { eventId: b.event.id, sessionId: bSession }),
      'invalid_state',
      'integrations_off',
    );
    await expectError(
      createZoomWebinar(userCtx(a.viewerId, a.org.id), ports, fakeAuth, {
        eventId: a.event.id,
        sessionId: S(1),
      }),
      'forbidden',
    );
    // Org B types A's webinar id: it is only "linked" there, and A's created webinar still wins.
    await executeCommand(
      linkZoomWebinarCommand,
      { eventId: b.event.id, sessionId: bSession, webinarId },
      b.ctx(),
      ports,
    );
    const zb = await executeQuery(zoomSetupQuery, { eventId: b.event.id }, b.ctx(), ports);
    expect(zb.sessions.find((s) => s.sessionId === bSession)).toMatchObject({ webinarId, created: false });
  });
});

describe('Zoom join/leave webhooks (M6.10a)', () => {
  const t0 = () => new Date(Date.now() - 5 * MINUTE_MS);

  it('verifies the signature before reading anything', async () => {
    const raw = joinBody({
      event: 'webinar.participant_joined',
      webinar: webinarId,
      ts: 1,
      email: T1().email,
      participant: 'p-forged',
      time: t0().toISOString(),
    });
    const now = new Date();
    const good = signZoomWebhook(SECRET, raw, now);
    const forged = signZoomWebhook('another-secret-0123456789abcdefghij', raw, now);
    expect((await deliver(raw, now, forged)).status).toBe(401);
    expect((await deliver(raw, now, {})).status).toBe(401);
    // A tampered body with the original signature.
    expect((await deliver(raw.replace('p-forged', 'p-other'), now, good)).status).toBe(401);
    // A captured request replayed after the five-minute window.
    expect((await deliver(raw, new Date(now.getTime() + 6 * MINUTE_MS), good)).status).toBe(401);
    // Not even parsed: garbage with a bad signature is 401, not 400.
    const garbage = await deliver('{not json', now, forged);
    expect(garbage).toMatchObject({ status: 401, verified: false });
    expect(
      await countOf(sql`select count(*)::int as n from virtual.zoom_participant_events
      where provider_event_id is not null and email = ${T1().email} and webinar_link_id in
      (select id from virtual.zoom_webinars where webinar_id = ${webinarId})`),
    ).toBe(0);
    // Off without a secret.
    expect((await processZoomWebhook(raw, new Headers(good), { secret: null, ports, now })).status).toBe(404);
  });

  it('answers Zoom’s URL validation only when signed', async () => {
    const raw = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'abc123' } });
    const ok = await deliver(raw);
    expect(ok.status).toBe(200);
    expect(ok.body?.plainToken).toBe('abc123');
    expect(ok.body?.encryptedToken).toMatch(/^[0-9a-f]{64}$/);
    expect((await deliver(raw, new Date(), {})).status).toBe(401);
  });

  it('a join and a leave replayed twice record once, make one segment and check in once', async () => {
    const joinedAt = new Date(Math.floor(t0().getTime() / 1000) * 1000);
    const leftAt = new Date(joinedAt.getTime() + 30 * MINUTE_MS);
    const join = joinBody({
      event: 'webinar.participant_joined',
      webinar: webinarId,
      ts: joinedAt.getTime(),
      email: T1().email.toUpperCase(),
      participant: 'p-1',
      time: joinedAt.toISOString(),
    });
    const leave = joinBody({
      event: 'webinar.participant_left',
      webinar: webinarId,
      ts: leftAt.getTime(),
      email: T1().email,
      participant: 'p-1',
      time: leftAt.toISOString(),
    });
    expect((await deliver(join)).body?.outcome).toBe('recorded');
    expect((await deliver(join)).body?.outcome).toBe('duplicate');
    expect((await deliver(leave)).body?.outcome).toBe('recorded');
    expect((await deliver(leave)).body?.outcome).toBe('duplicate');
    expect((await deliver(join)).body?.outcome).toBe('duplicate');
    const segs = await rows<{ ticket_id: string; joined_at: Date; left_at: Date }>(
      sql`select ticket_id, joined_at, left_at from virtual.zoom_attendance
          where webinar_link_id in (select id from virtual.zoom_webinars where webinar_id = ${webinarId})`,
    );
    expect(segs).toHaveLength(1);
    // Zoom keeps one registrant per address: the stay lands on that registrant's ticket.
    const [reg] = await rows<{ ticket_id: string }>(
      sql`select ticket_id from virtual.zoom_registrants where email = ${T1().email}
          and webinar_link_id in (select id from virtual.zoom_webinars where webinar_id = ${webinarId})`,
    );
    const ticketId = reg?.ticket_id as string;
    expect(segs[0]?.ticket_id).toBe(ticketId);
    expect(
      new Date(segs[0]?.left_at as Date).getTime() - new Date(segs[0]?.joined_at as Date).getTime(),
    ).toBe(30 * MINUTE_MS);
    expect(
      await countOf(sql`select count(*)::int as n from virtual.zoom_participant_events
        where ticket_id = ${ticketId} and session_id = ${S(2)}`),
    ).toBe(2);
    // The virtual checkpoint's event, once.
    expect(
      await countOf(sql`select count(*)::int as n from platform.domain_events
        where type = 'virtual.attended' and payload->>'ticketId' = ${ticketId}
          and payload->>'sessionId' = ${S(2)}`),
    ).toBe(1);

    // The report pulled later has the same stay: still one row (the report's times win).
    const reportLeft = new Date(leftAt.getTime() + 60_000);
    await withTenant(a.ctx(), (tx) =>
      recordZoomAttendanceTx(
        tx,
        a.ctx(),
        { webinarId, email: T1().email, joinedAt, leftAt: reportLeft },
        null,
      ),
    );
    const after = await rows<{ left_at: Date }>(
      sql`select left_at from virtual.zoom_attendance
          where webinar_link_id in (select id from virtual.zoom_webinars where webinar_id = ${webinarId})`,
    );
    expect(after).toHaveLength(1);
    expect(new Date(after[0]?.left_at as Date).getTime()).toBe(reportLeft.getTime());
  });

  it('a leave that arrives before its join still makes the segment; a rejoin is a second stay', async () => {
    const base = new Date(Math.floor((Date.now() - 2 * MINUTE_MS) / 1000) * 1000);
    const mk = (event: 'webinar.participant_joined' | 'webinar.participant_left', at: Date) =>
      joinBody({
        event,
        webinar: webinarId,
        ts: at.getTime(),
        email: T1().email,
        participant: 'p-2',
        time: at.toISOString(),
      });
    const j1 = mk('webinar.participant_joined', base);
    const l1 = mk('webinar.participant_left', new Date(base.getTime() + 20_000));
    const j2 = mk('webinar.participant_joined', new Date(base.getTime() + 40_000));
    const l2 = mk('webinar.participant_left', new Date(base.getTime() + 80_000));
    for (const raw of [l1, j1, j2, l2, l1, j2]) await deliver(raw);
    const segs = await rows<{ n: number }>(
      sql`select count(*)::int as n from virtual.zoom_attendance
          where joined_at >= ${base.toISOString()}::timestamptz
            and webinar_link_id in (select id from virtual.zoom_webinars where webinar_id = ${webinarId})`,
    );
    expect(segs[0]?.n).toBe(2);
  });

  it('ignores an unknown webinar and an ambiguous linked one; a participant without a ticket earns nothing', async () => {
    const raw = (webinar: string, email: string) =>
      joinBody({
        event: 'webinar.participant_joined',
        webinar,
        ts: Date.now(),
        email,
        participant: `p-${webinar}-${email}`,
        time: new Date().toISOString(),
      });
    expect((await deliver(raw('70000000001', T1().email))).body?.outcome).toBe('unknown_webinar');
    // Both fixture orgs linked 81234567890 by hand: nobody can tell whose it is.
    expect((await deliver(raw('81234567890', T1().email))).body?.outcome).toBe('unknown_webinar');
    // Org B also linked A's created webinar, which still resolves to A.
    const stranger = await deliver(raw(webinarId, 'stranger@example.test'));
    expect(stranger.body?.outcome).toBe('recorded');
    expect(
      await countOf(sql`select count(*)::int as n from virtual.zoom_participant_events
        where email = 'stranger@example.test' and ticket_id is null`),
    ).toBe(1);
    const inB = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from virtual.zoom_participant_events where email = 'stranger@example.test'`,
      ),
    );
    expect(inB[0]?.n).toBe(0);
  });

  it('the command runs only as the webhook (a person cannot record attendance)', async () => {
    await expectError(
      executeCommand(
        recordZoomParticipantCommand,
        {
          providerEventId: 'x',
          kind: 'joined',
          webinarId,
          participant: 'p',
          email: T1().email,
          at: new Date(),
        },
        a.ctx(),
        ports,
      ),
      'forbidden',
    );
  });
});
