import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import {
  CERTIFICATE_ISSUED_EVENT,
  calculateCreditsCommand,
  certificateByToken,
  certificateLinksQuery,
  certificateMailer,
  certificateText,
  certificateToken,
  ceSetupQuery,
  removeSessionRuleCommand,
  setCeSettingsCommand,
  setSessionRuleCommand,
  verifyCertificateQuery,
} from '@yayatoh/ce';
import { createCheckpointCommand, scanTicketCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  type EventDto,
  setEventDetailsCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { fakeIntegrations, runSync, zoomFakeAttend, zoomFakeRegistrants } from '@yayatoh/integrations';
import { type Ctx, createCtx, DomainError, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { catchUpSubscriber, consumeEvent, memoryNotifier, recentEventsTx } from '@yayatoh/platform';
import { createSessionCommand, setSessionAgendaCommand } from '@yayatoh/program';
import {
  registrantsOfLinkTx,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import {
  createStreamCommand,
  heartbeatCommand,
  linkZoomWebinarCommand,
  setTicketAccessCommand,
  startPlaybackCommand,
  syncZoomRegistrantsCommand,
  virtualTicketToken,
  zoomRegistrantsSubscriber,
  zoomSetupQuery,
} from '@yayatoh/virtual';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectZoom, fakeAuth, type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.9b Zoom and CE credits, on real Postgres with the fake Zoom API (IntegrationAuth port) and
 * the fake video provider: registrant sync that never duplicates, attendance reports, CE rules,
 * the calculation (exact, idempotent, revisions and withdrawals), certificates (document, mail,
 * links, public verification), permissions, entitlement and tenant isolation.
 */
let a: OrgFixture;
let b: OrgFixture;
const ORIGIN = 'https://app.yayatoh.test';
const H = 3_600_000;
const M = 60_000;
const START = new Date('2030-10-14T14:00:00Z');
const at = (h: number, min = 0, s = 0) => new Date(START.getTime() + h * H + min * M + s * 1000);
const WEBINAR = '81234500001';

interface Person {
  readonly name: string;
  readonly email: string;
  readonly token: string;
  readonly ticketId: string;
  readonly code: string;
}
let ev: EventDto;
let s1: string;
let s2: string;
let s3: string;
let door1: string;
let ada: Person;
let ben: Person;
let cara: Person;
let zoom: { connectionId: string; authConnectionId: string };
const memo = memoryNotifier();
const mailer = certificateMailer({ notifier: memo.notifier, appOrigin: ORIGIN });

const anon = (now: Date, org = a) => createCtx({ orgId: org.org.id, now });
const owner = (now: Date) => a.ctx({ now });

const expectError = async (p: Promise<unknown>, code: string, reason?: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (reason) expect((err as DomainError).details?.reason).toBe(reason);
};

async function register(name: string, member: string, item: string): Promise<Person> {
  const email = `${name.toLowerCase()}.${uuidv7().slice(-6)}@example.test`;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: ev.id,
      registrationTypeId: member,
      itemIds: [item],
      buyer: { email, name: `${name} Lovelace` },
    },
    anon(at(-72)),
    ports,
  );
  const [reg] = await withTenant(systemCtx(a.org.id), (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  const [t] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ short_code: string }>(sql`select short_code from ticketing.tickets where id = ${reg.id}`),
  );
  return {
    name: `${name} Lovelace`,
    email,
    token: r.manageToken,
    ticketId: reg.id,
    code: t?.short_code ?? '',
  };
}

async function session(title: string, h: number) {
  const r = await executeCommand(
    createSessionCommand,
    { eventId: ev.id, title, startsAt: at(h), endsAt: at(h + 1), capacity: null },
    a.ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    { eventId: ev.id, sessionId: r.session.id, admission: 'included', groupId: null },
    a.ctx(),
    ports,
  );
  return r.session.id;
}

const scan = (p: Person, now: Date, direction: 'in' | 'out') =>
  executeCommand(
    scanTicketCommand,
    { eventId: ev.id, code: p.code, checkpointId: door1, direction },
    owner(now),
    ports,
  );

/** Watch `sessionId` for `minutes` minutes from `from` (a heartbeat 10 s into each minute). */
async function watch(p: Person, sessionId: string, from: Date, minutes: number) {
  let token = '';
  let seq = 0;
  for (let i = 0; i < minutes; i++) {
    const now = new Date(from.getTime() + i * M + 10_000);
    if (i % 8 === 0) {
      const play = await executeCommand(
        startPlaybackCommand,
        { eventId: ev.id, sessionId, ticketToken: virtualTicketToken(p.ticketId) },
        anon(new Date(now.getTime() - 1000)),
        ports,
      );
      token = play.token;
      seq = 0;
    }
    seq += 1;
    const r = await executeCommand(heartbeatCommand, { token, seq }, anon(now), ports);
    expect(r.counted).toBe(true);
  }
}

const sync = (now: Date) =>
  runSync(a.org.id, zoom.connectionId, { auth: fakeAuth }, ports, { now, force: true });
const zoomAccount = () => {
  const acc = fakeIntegrations.account(zoom.authConnectionId);
  if (!acc) throw new Error('no fake zoom account');
  return acc;
};
const rule = (
  sessionId: string,
  credits: number,
  minMinutes: number,
  inPerson: boolean,
  online: boolean,
  now = at(-1),
) =>
  executeCommand(
    setSessionRuleCommand,
    { eventId: ev.id, sessionId, credits, minMinutes, countInPerson: inPerson, countVirtual: online },
    owner(now),
    ports,
  );
const calculate = (now = at(6)) =>
  executeCommand(calculateCreditsCommand, { eventId: ev.id }, owner(now), ports);
const certOf = (p: Person) =>
  withTenant(systemCtx(a.org.id), async (tx) => {
    const [r] = await tx.execute<{
      id: string;
      status: string;
      revision: number;
      total_credits: number;
      code: string;
    }>(
      sql`select id, status, revision, total_credits, code from ce.certificates where ticket_id = ${p.ticketId}`,
    );
    return r ?? null;
  });
const issuedEvents = async () =>
  (
    await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, [CERTIFICATE_ISSUED_EVENT], 24 * H),
    )
  ).filter((e) => (e.payload as { eventId?: string }).eventId === ev.id).length;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await executeCommand(
    createEventCommand,
    {
      name: 'Harbor Health Summit',
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: at(0),
      endsAt: at(10),
    },
    a.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, a.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, a.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const fullPass = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  await executeCommand(
    setCellCommand,
    { eventId: ev.id, registrationTypeId: member, admissionItemId: fullPass, priceMinor: 0 },
    a.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, a.ctx(), ports);
  await executeCommand(setEventDetailsCommand, { eventId: ev.id, attendanceMode: 'hybrid' }, a.ctx(), ports);
  s1 = await session('Opening keynote', 1);
  s2 = await session('Clinical update', 3);
  s3 = await session('Closing drinks', 5);
  ada = await register('Ada', member, fullPass);
  ben = await register('Ben', member, fullPass);
  cara = await register('Cara', member, fullPass);
  const [type] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ ticket_type_id: string }>(
      sql`select ticket_type_id from ticketing.tickets where id = ${ada.ticketId}`,
    ),
  );
  await executeCommand(
    setTicketAccessCommand,
    { eventId: ev.id, ticketTypeId: type?.ticket_type_id as string, access: 'both' },
    a.ctx(),
    ports,
  );
  await executeCommand(createStreamCommand, { eventId: ev.id, sessionId: s1 }, a.ctx(), ports);
  const cp = await executeCommand(
    createCheckpointCommand,
    {
      eventId: ev.id,
      name: 'Keynote door',
      kind: 'session',
      sessionId: s1,
      capacity: null,
      selfCheckin: false,
    },
    a.ctx(),
    ports,
  );
  door1 = cp.id;
  zoom = await connectZoom(a.ctx());
}, 240_000);

afterAll(async () => {
  await closePools();
});

describe('Zoom registrants (M6.9b)', () => {
  it('linking a webinar registers every holder with online access, once, however often it syncs', async () => {
    await expectError(
      executeCommand(
        linkZoomWebinarCommand,
        { eventId: ev.id, sessionId: s2, webinarId: '12ab' },
        a.ctx(),
        ports,
      ),
      'validation_failed',
      'webinar_id',
    );
    const linked = await executeCommand(
      linkZoomWebinarCommand,
      { eventId: ev.id, sessionId: s2, webinarId: '812 3450 0001' },
      a.ctx(),
      ports,
    );
    expect(linked).toEqual({ added: 3, updated: 0, webinarId: WEBINAR });
    // The same webinar cannot serve a second session.
    await expectError(
      executeCommand(
        linkZoomWebinarCommand,
        { eventId: ev.id, sessionId: s3, webinarId: WEBINAR },
        a.ctx(),
        ports,
      ),
      'conflict',
      'webinar_taken',
    );
    // Linking again, and reconciling, add nothing.
    expect(
      await executeCommand(
        linkZoomWebinarCommand,
        { eventId: ev.id, sessionId: s2, webinarId: WEBINAR },
        a.ctx(),
        ports,
      ),
    ).toMatchObject({ added: 0, updated: 0 });
    expect(
      await executeCommand(syncZoomRegistrantsCommand, { eventId: ev.id }, a.ctx(), ports),
    ).toMatchObject({
      added: 0,
      updated: 0,
    });

    expect((await sync(at(-2))).runStatus).toBe('succeeded');
    const first = zoomFakeRegistrants(zoomAccount(), WEBINAR);
    expect(first.map((r) => r.email).sort()).toEqual([ada.email, ben.email, cara.email].sort());
    // A second sync sends nothing; a sync whose answers were lost re-sends with the same keys.
    const ours = () => zoomAccount().log.filter((l) => l.method === 'POST' && l.path.includes(WEBINAR));
    const sent = () => ours().length;
    const before = sent();
    await sync(at(-2, 5));
    expect(sent()).toBe(before);
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`delete from integrations.record_links where connection_id = ${zoom.connectionId}`),
    );
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`delete from integrations.sync_cursors where connection_id = ${zoom.connectionId}`),
    );
    await sync(at(-2, 10));
    const posts = ours();
    expect(posts.length).toBe(before + 3);
    const keys = posts.map((p) => p.idempotencyKey);
    // The resend used the first sends' keys (same rows, same content).
    expect(new Set(keys).size).toBe(3);
    expect(zoomFakeRegistrants(zoomAccount(), WEBINAR)).toHaveLength(3);
    expect(zoomFakeRegistrants(zoomAccount(), WEBINAR).map((r) => r.registrant_id)).toEqual(
      first.map((r) => r.registrant_id),
    );
  });

  it('a new holder (order.paid) becomes a registrant at the next sync; nothing is duplicated', async () => {
    const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    const member = setup.types.find((t) => t.key === 'member')?.id as string;
    const fullPass = setup.items.find((i) => i.key === 'full_pass')?.id as string;
    const dan = await register('Dan', member, fullPass);
    const [order] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ order_id: string }>(
        sql`select order_id from ticketing.tickets where id = ${dan.ticketId}`,
      ),
    );
    for (let i = 0; i < 2; i++)
      await consumeEvent(zoomRegistrantsSubscriber(), {
        id: uuidv7(),
        orgId: a.org.id,
        type: 'order.paid',
        version: 1,
        aggregateType: 'order',
        aggregateId: order?.order_id as string,
        payload: { orgId: a.org.id, orderId: order?.order_id },
        logSeq: 0,
      } as never);
    await sync(at(-1, 30));
    expect(zoomFakeRegistrants(zoomAccount(), WEBINAR)).toHaveLength(4);
    const setupZoom = await executeQuery(zoomSetupQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(setupZoom.sessions.find((s) => s.sessionId === s2)).toMatchObject({
      webinarId: WEBINAR,
      registrants: 4,
      attendees: 0,
    });
  });
});

describe('attendance and CE credits (M6.9b)', () => {
  it('a fixture attendee’s certificate reproduces exactly from scans, watch time and Zoom', async () => {
    // Ada: keynote door 14:00:30 → 14:30 local+1h (30 minutes), watched 25 → 44 (20 minutes,
    // 5 of them while still in the room): 45 counted minutes. Clinical update on Zoom: 35 minutes.
    await scan(ada, at(1, 0, 30), 'in');
    await scan(ada, at(1, 30), 'out');
    await watch(ada, s1, at(1, 25), 20);
    // Ben: in the room 30 minutes only (below 45); on Zoom 20 minutes (below 30).
    await scan(ben, at(1, 10), 'in');
    await scan(ben, at(1, 40), 'out');
    zoomFakeAttend(zoomAccount(), WEBINAR, {
      email: ada.email,
      name: ada.name,
      joinedAt: at(3),
      leftAt: at(3, 20),
    });
    zoomFakeAttend(zoomAccount(), WEBINAR, {
      email: ada.email.toUpperCase(),
      name: ada.name,
      joinedAt: at(3, 19, 30),
      leftAt: at(3, 35),
    });
    zoomFakeAttend(zoomAccount(), WEBINAR, {
      email: ben.email,
      name: ben.name,
      joinedAt: at(3, 40),
      leftAt: at(4),
    });
    // Someone we never registered: kept, earns nothing.
    zoomFakeAttend(zoomAccount(), WEBINAR, {
      email: 'walk.in@example.test',
      name: 'Walk In',
      joinedAt: at(3),
      leftAt: at(4),
    });
    // The report is pulled only after the session ends, then never twice.
    await sync(at(3, 50));
    expect(await zoomRows()).toBe(0);
    await sync(at(4, 30));
    expect(await zoomRows()).toBe(4);
    await sync(at(4, 45));
    expect(await zoomRows()).toBe(4);
    expect(
      (await executeQuery(zoomSetupQuery, { eventId: ev.id }, a.ctx(), ports)).sessions.find(
        (s) => s.sessionId === s2,
      ),
    ).toMatchObject({ attendees: 2 });

    await executeCommand(
      setCeSettingsCommand,
      { eventId: ev.id, creditLabel: 'CPE credits', accreditor: 'Harbor Board of Accountancy' },
      a.ctx(),
      ports,
    );
    await rule(s1, 150, 45, true, true);
    await rule(s2, 100, 30, false, true);
    await rule(s3, 50, 10, true, true);
    // Not over yet: nothing counts.
    expect(await calculate(at(1, 30))).toMatchObject({ issued: 0, pendingSessions: 3 });
    expect(await calculate()).toEqual({
      issued: 1,
      revised: 0,
      revoked: 0,
      unchanged: 0,
      below: 1,
      pendingSessions: 0,
    });
    const cert = await certOf(ada);
    expect(cert).toMatchObject({ status: 'issued', revision: 1, total_credits: 250 });
    expect(await certOf(ben)).toBeNull();
    expect(await certOf(cara)).toBeNull();

    const doc = await certificateByToken(a.org.id, certificateToken(cert?.id as string), ORIGIN);
    expect(doc).not.toBeNull();
    const text = certificateText(doc?.doc as never, 'en');
    expect({ ...text, facts: text.facts.slice(0, 1) }).toEqual({
      lang: 'en',
      dir: 'ltr',
      title: 'Certificate of attendance',
      certifies: 'This certifies that',
      name: 'Ada Lovelace',
      attended: `attended Harbor Health Summit, organized by ${a.org.name},`,
      earned: 'and earned 2.5 CPE credits.',
      headers: ['Session', 'Date', 'In person (min)', 'Online (min)', 'Counted (min)', 'Credits'],
      rows: [
        ['Opening keynote', 'Oct 14, 2030', '30', '20', '45', '1.5'],
        ['Clinical update', 'Oct 14, 2030', '0', '35', '35', '1'],
      ],
      totalRow: ['Total', '2.5'],
      statements: [
        `${a.org.name} states that these credits are awarded under its accreditation with Harbor Board of Accountancy. Accreditation is the organizer’s responsibility.`,
        'Credits are based on session check-in scans and online watch time recorded for this attendee, counted once per minute, against the minimum attendance the organizer set for each session.',
        `Check this certificate at ${ORIGIN}/certificates/${a.org.id}/verify/${cert?.code} with the code ${cert?.code}.`,
      ],
      facts: [['Verification code', cert?.code]],
      revoked: null,
      footer: `Issued by ${a.org.name}. Yayatoh records attendance and issues certificates on its behalf.`,
    });
    // Arabic: right to left, Arabic digits for the credits.
    const ar = certificateText(doc?.doc as never, 'ar');
    expect(ar).toMatchObject({ lang: 'ar', dir: 'rtl', title: 'شهادة حضور' });
    expect(ar.totalRow[1]).toBe(new Intl.NumberFormat('ar', { maximumFractionDigits: 2 }).format(2.5));

    // Mailed once to Ada only, with her PDF link.
    await catchUpSubscriber(mailer, a.org.id);
    await catchUpSubscriber(mailer, a.org.id);
    const mail = memo.sent.filter((m) => m.kind === 'ce.certificate');
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      to: { email: ada.email, name: 'Ada Lovelace' },
      dedupeKey: `ce-certificate:${cert?.id}:1`,
      params: { credits: '2.5 CPE credits', code: cert?.code, revision: 1 },
    });
    expect(String(mail[0]?.params.url)).toBe(
      `${ORIGIN}/certificates/${a.org.id}/${certificateToken(cert?.id as string)}`,
    );
    expect(String(mail[0]?.params.body)).toContain('Opening keynote (Oct 14, 2030): 1.5 · 45 min');
  });

  it('re-running the calculation is idempotent: nothing changes, nothing is sent again', async () => {
    const events = await issuedEvents();
    expect(await calculate(at(7))).toEqual({
      issued: 0,
      revised: 0,
      revoked: 0,
      unchanged: 1,
      below: 1,
      pendingSessions: 0,
    });
    expect(await calculate(at(8))).toMatchObject({ unchanged: 1 });
    expect(await issuedEvents()).toBe(events);
    expect(await certOf(ada)).toMatchObject({ revision: 1, total_credits: 250 });
  });

  it('a stricter rule revises the certificate; no qualifying session withdraws it; it can come back', async () => {
    await rule(s1, 150, 46, true, true);
    expect(await calculate()).toMatchObject({ revised: 1 });
    expect(await certOf(ada)).toMatchObject({ status: 'issued', revision: 2, total_credits: 100 });
    await catchUpSubscriber(mailer, a.org.id);
    await executeCommand(removeSessionRuleCommand, { eventId: ev.id, sessionId: s2 }, a.ctx(), ports);
    expect(await calculate()).toMatchObject({ revoked: 1 });
    const revoked = await certOf(ada);
    expect(revoked).toMatchObject({ status: 'revoked', total_credits: 0 });
    // Withdrawn: verifiable as such, no download link on the order page.
    const v = await executeQuery(
      verifyCertificateQuery,
      { code: revoked?.code as string },
      anon(at(9)),
      ports,
    );
    expect(v).toMatchObject({ status: 'revoked', holder: 'Ada L.' });
    expect(
      await executeQuery(
        certificateLinksQuery,
        { eventId: ev.id, ticketIds: [ada.ticketId] },
        anon(at(9)),
        ports,
      ),
    ).toEqual([]);
    await rule(s1, 150, 45, true, true);
    await rule(s2, 100, 30, false, true);
    expect(await calculate()).toMatchObject({ revised: 1 });
    expect(await certOf(ada)).toMatchObject({ status: 'issued', revision: 3, total_credits: 250 });
    await catchUpSubscriber(mailer, a.org.id);
    // Revision 2 and 3 were mailed (each once); the withdrawn one was not.
    expect(memo.sent.filter((m) => m.kind === 'ce.certificate').map((m) => m.params.revision)).toEqual([
      1, 2, 3,
    ]);
  });

  it('the public verification and the order page link; never the full name or the address', async () => {
    const cert = await certOf(ada);
    const lower = String(cert?.code).toLowerCase().replace('-', ' ');
    const v = await executeQuery(verifyCertificateQuery, { code: lower }, anon(at(9)), ports);
    expect(v).toMatchObject({
      code: cert?.code,
      status: 'issued',
      holder: 'Ada L.',
      eventName: 'Harbor Health Summit',
      creditLabel: 'CPE credits',
      totalCredits: 250,
      revision: 3,
    });
    expect(JSON.stringify(v)).not.toContain('Lovelace');
    expect(JSON.stringify(v)).not.toContain(ada.email);
    await expectError(
      executeQuery(verifyCertificateQuery, { code: 'ZZZZZ-ZZZZZ' }, anon(at(9)), ports),
      'not_found',
    );
    // Another org cannot verify it, nor read it by link.
    await expectError(
      executeQuery(verifyCertificateQuery, { code: cert?.code as string }, anon(at(9), b), ports),
      'not_found',
    );
    expect(await certificateByToken(b.org.id, certificateToken(cert?.id as string), ORIGIN)).toBeNull();
    expect(
      await certificateByToken(a.org.id, `${certificateToken(cert?.id as string).slice(0, -2)}xx`, ORIGIN),
    ).toBeNull();
    const links = await executeQuery(
      certificateLinksQuery,
      { eventId: ev.id, ticketIds: [ada.ticketId, ben.ticketId] },
      anon(at(9)),
      ports,
    );
    expect(links).toEqual([{ ticketId: ada.ticketId, token: certificateToken(cert?.id as string) }]);
  });

  it('organizer views list certificates; viewers read but cannot change; the entitlement gates it', async () => {
    const setup = await executeQuery(ceSetupQuery, { eventId: ev.id }, a.ctx({ now: at(9) }), ports);
    expect(setup.certificates.map((c) => [c.holderName, c.totalCredits, c.status])).toEqual([
      ['Ada Lovelace', 250, 'issued'],
    ]);
    expect(setup.sessions.find((s) => s.sessionId === s1)).toMatchObject({ ended: true, awarded: 1 });
    const viewer: Ctx = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(ceSetupQuery, { eventId: ev.id }, viewer, ports)).eventId).toBe(ev.id);
    await expectError(
      executeCommand(calculateCreditsCommand, { eventId: ev.id }, viewer, ports),
      'forbidden',
    );
    await expectError(
      executeCommand(
        setSessionRuleCommand,
        { eventId: ev.id, sessionId: s1, credits: 1, minMinutes: 1, countInPerson: true, countVirtual: true },
        viewer,
        ports,
      ),
      'forbidden',
    );
    await expectError(
      executeCommand(
        setSessionRuleCommand,
        {
          eventId: ev.id,
          sessionId: s1,
          credits: 100,
          minMinutes: 10,
          countInPerson: false,
          countVirtual: false,
        },
        a.ctx(),
        ports,
      ),
      'validation_failed',
    );
    // Another org's event is not found from b.
    await expectError(executeQuery(ceSetupQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'virtual', effect: 'revoke', reason: 'test' },
      systemCtx(b.org.id),
      ports,
    );
    await expectError(
      executeQuery(ceSetupQuery, { eventId: b.event.id }, b.ctx(), ports),
      'module_not_enabled',
    );
    await expectError(
      executeQuery(verifyCertificateQuery, { code: 'ZZZZZ-ZZZZZ' }, createCtx({ orgId: b.org.id }), ports),
      'module_not_enabled',
    );
  });
});

const zoomRows = async () => {
  const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from virtual.zoom_attendance where event_id = ${ev.id}`,
    ),
  );
  return r?.n ?? 0;
};
