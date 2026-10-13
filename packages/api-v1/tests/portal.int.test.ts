import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { recordTermConsentTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  createPortalSession,
  type EventDto,
  portalCtx,
  portalInviteToken,
  portalPrincipalBySession,
  transitionEventCommand,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { acceptLeadTermsCommand, LEAD_TERMS_VERSION } from '@yayatoh/leads';
import { fakePaymentProvider } from '@yayatoh/payments';
import { createRateLimiter, memoryRateLimitStore } from '@yayatoh/platform/security';
import {
  createExhibitorCommand,
  inviteExhibitorMemberCommand,
  portalAssignLeadLicenseCommand,
  portalInviteStaffCommand,
  revokeExhibitorMemberCommand,
  saveLeadLicenseSettingsCommand,
} from '@yayatoh/program';
import {
  registrantsOfLinkTx,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, type PortalMail, type V1Deps } from '../src/index.ts';

/**
 * M7.2e: the exhibitor rep's bearer session (email code as in P5-7, short-lived access token with
 * a rotating refresh token as in M1.2f) and the lead routes over it: own exhibitor only, only the
 * fields the attendee agreed to share (P5-8), no scanning without a licence (P5-4).
 */
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const sent: PortalMail[] = [];
const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(auth),
  payments: () => payments,
  telemetry: false,
  portalMail: async (m) => {
    sent.push(m);
  },
  portalLimiter: createRateLimiter(memoryRateLimitStore()),
  publicOrigin: 'https://app.test',
};
const app = new Hono();
app.route('/v1', createV1(deps));

type Json = Record<string, unknown>;
async function call(method: string, path: string, token?: string, bodyJson?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(bodyJson !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
  });
  const text = await res.text();
  return { res, status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

/** The lead of the n-th result of a scan batch response. */
const leadOf = (body: Json, n = 0): Json => {
  const lead = ((body.results as Json[])[n] as Json).lead;
  if (!lead) throw new Error(`result ${n} has no lead`);
  return lead as Json;
};

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let n = 0;
const H = 3_600_000;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const scanId = () => `scan-${uniq()}-${Math.random().toString(36).slice(2, 8)}`;

/** The event is live now, so the real clock is inside the capture window. */
async function conference(org: OrgFixture, name: string) {
  const startsAt = new Date(Date.now() + 2 * H);
  const event = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * H),
    },
    org.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: event.id, names: {} }, org.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: event.id }, org.ctx(), ports);
  await executeCommand(
    setCellCommand,
    {
      eventId: event.id,
      registrationTypeId: setup.types.find((t) => t.key === 'member')?.id as string,
      admissionItemId: setup.items.find((i) => i.key === 'full_pass')?.id as string,
      priceMinor: 0,
    },
    org.ctx(),
    ports,
  );
  await executeCommand(
    transitionEventCommand,
    { eventId: event.id, transition: 'publish' },
    org.ctx(),
    ports,
  );
  await executeCommand(
    saveLeadLicenseSettingsCommand,
    { eventId: event.id, includedLeadLicenses: 2, leadLicensePriceMinor: null },
    org.ctx(),
    ports,
  );
  return event;
}

async function adminCtx(orgId: string, accountId: string): Promise<Ctx> {
  const s = await createPortalSession({ orgId, accountId, host: 'portal.test' });
  const p = await portalPrincipalBySession(s.token, 'portal.test');
  if (!p) throw new Error('no principal');
  return portalCtx(p, 'en');
}

interface Team {
  exhibitorId: string;
  admin: string;
  staff: string[];
}

/** An exhibitor with an admin (holding the included license), staff invited, terms accepted. */
async function team(name: string, staff = 1, org = a, event = ev): Promise<Team> {
  const x = await executeCommand(createExhibitorCommand, { eventId: event.id, name }, org.ctx(), ports);
  const inv = await executeCommand(
    inviteExhibitorMemberCommand,
    { eventId: event.id, exhibitorId: x.id, email: `admin+${uniq()}@x.example`, role: 'exhibitor_admin' },
    org.ctx(),
    ports,
  );
  const admin = inv.member.id;
  const ctx = await adminCtx(org.org.id, admin);
  const ids: string[] = [];
  for (let i = 0; i < staff; i++) {
    const r = await executeCommand(
      portalInviteStaffCommand,
      { email: `staff+${uniq()}@x.example` },
      ctx,
      ports,
    );
    ids.push((r as { member: { id: string } }).member.id);
  }
  await executeCommand(portalAssignLeadLicenseCommand, { accountId: admin }, ctx, ports);
  await executeCommand(acceptLeadTermsCommand, { version: LEAD_TERMS_VERSION }, ctx, ports);
  return { exhibitorId: x.id, admin, staff: ids };
}

interface Attendee {
  email: string;
  code: string;
}

async function attendee(consent: boolean, org = a, event = ev): Promise<Attendee> {
  const setup = await executeQuery(registrationSetupQuery, { eventId: event.id }, org.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const full = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  const email = `guest+${uniq()}@example.test`;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: event.id,
      registrationTypeId: member,
      itemIds: [full],
      buyer: { email, name: `Guest ${uniq()}` },
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
  const sys = systemCtx(org.org.id);
  const [reg] = await withTenant(sys, (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  const [t] = await withTenant(sys, (tx) =>
    tx.execute<{ short_code: string }>(sql`select short_code from ticketing.tickets where id = ${reg.id}`),
  );
  if (consent)
    await withTenant(sys, (tx) =>
      recordTermConsentTx(tx, sys, {
        email,
        name: null,
        term: 'exhibitor_email_sharing',
        version: 1,
        evidence: 'test:registration_form',
      }),
    );
  return { email, code: t?.short_code ?? '' };
}

async function inviteTokenOf(orgId: string, accountId: string) {
  const [row] = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ invite_version: number }>(
      sql`select invite_version from events.portal_accounts where id = ${accountId}`,
    ),
  );
  return portalInviteToken(orgId, accountId, row?.invite_version ?? 1);
}

/** Sign in as the account by the emailed code, the way the app does. */
async function signIn(accountId: string, org = a) {
  const inviteToken = await inviteTokenOf(org.org.id, accountId);
  sent.length = 0;
  const asked = await call('POST', '/portal/auth/code', undefined, { inviteToken });
  expect(asked.status).toBe(200);
  expect(asked.body.status).toBe('sent');
  const mail = sent.at(-1);
  const code = String(mail?.params.code);
  const r = await call('POST', '/portal/auth/token', undefined, {
    grantType: 'code',
    inviteToken,
    challengeId: asked.body.challengeId,
    code,
  });
  expect(r.status).toBe(200);
  return {
    access: String(r.body.accessToken),
    refresh: String(r.body.refreshToken),
    inviteToken,
    challengeId: String(asked.body.challengeId),
    mail,
  };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await conference(a, `Portal API ${a.org.slug}`);
});
afterAll(closePools);

describe('/v1/portal/auth — the email-code sign-in as bearer tokens', () => {
  it('emails a code and returns a short access token with a refresh token', async () => {
    const t = await team('Signin Co');
    const s = await signIn(t.admin);
    expect(s.access).toMatch(/^yyp_/);
    expect(s.refresh).toMatch(/^yyr_/);
    expect(s.mail).toMatchObject({ kind: 'portal.sign-in', params: { eventName: ev.name } });
    const setup = await call('GET', '/portal/leads/setup', s.access);
    expect(setup.status).toBe(200);
    expect(setup.body).toMatchObject({
      exhibitorName: 'Signin Co',
      role: 'exhibitor_admin',
      license: 'licensed',
    });
  });

  it('says how many tries are left on a wrong code, and a spent code cannot be used twice', async () => {
    const t = await team('Wrong Code Co');
    const inviteToken = await inviteTokenOf(a.org.id, t.admin);
    sent.length = 0;
    const asked = await call('POST', '/portal/auth/code', undefined, { inviteToken });
    const wrong = await call('POST', '/portal/auth/token', undefined, {
      grantType: 'code',
      inviteToken,
      challengeId: asked.body.challengeId,
      code: '000000',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'wrong_code', attemptsLeft: 4 },
    });
    const code = String(sent.at(-1)?.params.code);
    const body = { grantType: 'code', inviteToken, challengeId: asked.body.challengeId, code };
    expect((await call('POST', '/portal/auth/token', undefined, body)).status).toBe(200);
    const again = await call('POST', '/portal/auth/token', undefined, body);
    expect(again.status).toBe(401);
    expect(again.body).toMatchObject({ details: { reason: 'code_used' } });
  });

  it('locks the code after five wrong tries, even against the right one', async () => {
    const t = await team('Lock Co');
    const inviteToken = await inviteTokenOf(a.org.id, t.admin);
    sent.length = 0;
    const asked = await call('POST', '/portal/auth/code', undefined, { inviteToken });
    const code = String(sent.at(-1)?.params.code);
    for (let i = 0; i < 5; i++)
      await call('POST', '/portal/auth/token', undefined, {
        grantType: 'code',
        inviteToken,
        challengeId: asked.body.challengeId,
        code: '111111',
      });
    const r = await call('POST', '/portal/auth/token', undefined, {
      grantType: 'code',
      inviteToken,
      challengeId: asked.body.challengeId,
      code,
    });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ details: { reason: 'code_locked' } });
  });

  it('a second request inside the cooldown sends no new code', async () => {
    const t = await team('Cooldown Co');
    const inviteToken = await inviteTokenOf(a.org.id, t.admin);
    sent.length = 0;
    const first = await call('POST', '/portal/auth/code', undefined, { inviteToken });
    const second = await call('POST', '/portal/auth/code', undefined, { inviteToken });
    expect(first.body.status).toBe('sent');
    expect(second.body).toMatchObject({ status: 'cooldown', challengeId: first.body.challengeId });
    expect(sent).toHaveLength(1);
  });

  it('refuses a forged, another org’s or a revoked invitation the same way (403)', async () => {
    const t = await team('Refused Co');
    const forged = await call('POST', '/portal/auth/code', undefined, { inviteToken: 'x'.repeat(60) });
    expect(forged.status).toBe(403);
    const tampered = (await inviteTokenOf(a.org.id, t.admin)).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await call('POST', '/portal/auth/code', undefined, { inviteToken: tampered })).status).toBe(403);
    const live = await inviteTokenOf(a.org.id, t.staff[0] as string);
    await executeCommand(
      revokeExhibitorMemberCommand,
      { eventId: ev.id, memberId: t.staff[0] as string },
      a.ctx(),
      ports,
    );
    sent.length = 0;
    expect((await call('POST', '/portal/auth/code', undefined, { inviteToken: live })).status).toBe(403);
    expect(sent).toHaveLength(0);
    expect((await call('POST', '/portal/auth/code', undefined, {})).status).toBe(400);
  });

  it('refresh rotates the pair; the old access token and the spent refresh token stop working', async () => {
    const t = await team('Refresh Co');
    const s = await signIn(t.admin);
    const r = await call('POST', '/portal/auth/token', undefined, {
      grantType: 'refresh_token',
      refreshToken: s.refresh,
    });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).not.toBe(s.refresh);
    expect((await call('GET', '/portal/leads/setup', s.access)).status).toBe(401);
    expect((await call('GET', '/portal/leads/setup', String(r.body.accessToken))).status).toBe(200);
    // The spent refresh token presented again ends the whole session.
    const reuse = await call('POST', '/portal/auth/token', undefined, {
      grantType: 'refresh_token',
      refreshToken: s.refresh,
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body).toMatchObject({ details: { reason: 'refresh_token_reused' } });
    expect((await call('GET', '/portal/leads/setup', String(r.body.accessToken))).status).toBe(401);
    const dead = await call('POST', '/portal/auth/token', undefined, {
      grantType: 'refresh_token',
      refreshToken: String(r.body.refreshToken),
    });
    expect(dead.status).toBe(401);
    const junk = await call('POST', '/portal/auth/token', undefined, {
      grantType: 'refresh_token',
      refreshToken: 'nope',
    });
    expect(junk.status).toBe(401);
    expect(junk.body).toMatchObject({ details: { reason: 'refresh_token_invalid' } });
  });

  it('sign-out ends the session; the browser cookie token is not a bearer token', async () => {
    const t = await team('Signout Co');
    const s = await signIn(t.admin);
    expect((await call('POST', '/portal/auth/revoke', undefined, { refreshToken: s.refresh })).status).toBe(
      204,
    );
    expect((await call('GET', '/portal/leads/setup', s.access)).status).toBe(401);
    expect((await call('POST', '/portal/auth/revoke', undefined, { refreshToken: 'unknown' })).status).toBe(
      204,
    );
    const cookie = await createPortalSession({ orgId: a.org.id, accountId: t.admin, host: 'portal.test' });
    expect(
      (await call('GET', '/portal/leads/setup', `yyp_${a.org.id}~${cookie.token.split('~')[1]}`)).status,
    ).toBe(401);
    expect((await call('GET', '/portal/leads/setup', cookie.token)).status).toBe(401);
  });

  it('revoking the account ends its bearer session at the next request', async () => {
    const t = await team('Revoked Co');
    const s = await signIn(t.staff[0] as string);
    expect((await call('GET', '/portal/leads/setup', s.access)).status).toBe(200);
    await executeCommand(
      revokeExhibitorMemberCommand,
      { eventId: ev.id, memberId: t.staff[0] as string },
      a.ctx(),
      ports,
    );
    expect((await call('GET', '/portal/leads/setup', s.access)).status).toBe(401);
    expect(
      (
        await call('POST', '/portal/auth/token', undefined, {
          grantType: 'refresh_token',
          refreshToken: s.refresh,
        })
      ).status,
    ).toBe(401);
  });

  it('every lead route needs a portal token (problem+json 401); device and user tokens do not work', async () => {
    const paths = [
      ['GET', '/portal/leads/setup'],
      ['GET', '/portal/leads'],
      ['POST', '/portal/leads/scans'],
      ['PATCH', `/portal/leads/${crypto.randomUUID()}`],
    ] as const;
    for (const [method, path] of paths) {
      const none = await call(method, path, undefined, method === 'GET' ? undefined : {});
      expect(none.status, `${method} ${path}`).toBe(401);
      expect(none.res.headers.get('content-type')).toBe('application/problem+json');
      expect((await call(method, path, a.apiKey, method === 'GET' ? undefined : {})).status).toBe(401);
      expect(
        (await call(method, path, `yyp_${a.org.id}~${'x'.repeat(43)}`, method === 'GET' ? undefined : {}))
          .status,
      ).toBe(401);
    }
  });

  it('resends my invitation without saying whether the address has access', async () => {
    const t = await team('Resend Co', 0);
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ email: string }>(sql`select email from events.portal_accounts where id = ${t.admin}`),
    );
    const { portalSiteToken } = await import('@yayatoh/events');
    const siteToken = portalSiteToken(a.org.id, ev.id);
    sent.length = 0;
    const known = await call('POST', '/portal/auth/invitations', undefined, { siteToken, email: row?.email });
    const unknown = await call('POST', '/portal/auth/invitations', undefined, {
      siteToken,
      email: 'nobody@nowhere.example',
    });
    expect(known.status).toBe(204);
    expect(unknown.status).toBe(204);
    expect(sent.map((m) => m.kind)).toEqual(['portal.invite']);
    expect(sent[0]?.to).toBe(row?.email);
    expect(
      (
        await call('POST', '/portal/auth/invitations', undefined, {
          siteToken: 'z'.repeat(60),
          email: 'a@b.example',
        })
      ).status,
    ).toBe(403);
  });
});

describe('/v1/portal/leads — own exhibitor, consented fields, licence', () => {
  const scan = (code: string, extra: Json = {}) => ({
    scanId: scanId(),
    code,
    capturedAt: new Date().toISOString(),
    offline: false,
    ...extra,
  });

  it('captures a batch: the email only with consent, never phone or address; a resend is a no-op', async () => {
    const t = await team('Capture Co');
    const s = await signIn(t.admin);
    const yes = await attendee(true);
    const no = await attendee(false);
    const batch = [scan(yes.code), scan(no.code), scan('NOTACODE1')];
    const r = await call('POST', '/portal/leads/scans', s.access, { scans: batch });
    expect(r.status).toBe(200);
    const results = r.body.results as Json[];
    expect(results.map((x) => x.status)).toEqual(['captured', 'captured', 'refused']);
    expect(leadOf(r.body, 0).email).toBe(yes.email);
    expect(leadOf(r.body, 0).sharedFields).toEqual(['name', 'job_title', 'company', 'email']);
    expect(leadOf(r.body, 1).email).toBeNull();
    expect(results[2]?.lead).toBeNull();
    expect(JSON.stringify(r.body)).not.toMatch(/ticketId|orgId|org_id|address|phone/);
    const again = await call('POST', '/portal/leads/scans', s.access, { scans: batch });
    expect(again.body).toEqual(r.body);
    const list = await call('GET', '/portal/leads', s.access);
    expect(list.status).toBe(200);
    expect((list.body.leads as Json[]).length).toBe(2);
    expect(list.body.scope).toBe('all');
  });

  it('a rep sees only their own exhibitor’s leads; another exhibitor’s lead is 404 to rate', async () => {
    const t1 = await team('Mine Co');
    const t2 = await team('Theirs Co');
    const mine = await signIn(t1.admin);
    const theirs = await signIn(t2.admin);
    const guest = await attendee(true);
    const cap = await call('POST', '/portal/leads/scans', theirs.access, { scans: [scan(guest.code)] });
    const leadId = String(leadOf(cap.body).id);
    expect(((await call('GET', '/portal/leads', mine.access)).body.leads as Json[]).length).toBe(0);
    const patch = (token: string) =>
      call('PATCH', `/portal/leads/${leadId}`, token, { rating: 'hot', qualifiers: [], notes: 'follow up' });
    expect((await patch(mine.access)).status).toBe(404);
    expect((await patch(theirs.access)).status).toBe(200);
    const after = (await call('GET', '/portal/leads', theirs.access)).body.leads as Json[];
    expect(after[0]).toMatchObject({ rating: 'hot', notes: 'follow up' });
  });

  it('validates a patch and a scan (rating, notes length, empty batch)', async () => {
    const t = await team('Validation Co');
    const s = await signIn(t.admin);
    const guest = await attendee(false);
    const cap = await call('POST', '/portal/leads/scans', s.access, { scans: [scan(guest.code)] });
    const leadId = String(leadOf(cap.body).id);
    const bad = (extra: Json) =>
      call('PATCH', `/portal/leads/${leadId}`, s.access, {
        rating: null,
        qualifiers: [],
        notes: '',
        ...extra,
      });
    expect((await bad({ rating: 'lukewarm' })).status).toBe(400);
    expect((await bad({ notes: 'x'.repeat(5000) })).status).toBe(400);
    expect((await call('POST', '/portal/leads/scans', s.access, { scans: [] })).status).toBe(400);
    expect((await call('PATCH', '/portal/leads/not-a-uuid', s.access, {})).status).toBe(400);
  });

  it('a rep without a licence cannot scan, but still reads their setup', async () => {
    const t = await team('Unlicensed Co', 1);
    const staff = await signIn(t.staff[0] as string);
    const setup = await call('GET', '/portal/leads/setup', staff.access);
    expect(setup.body).toMatchObject({ role: 'exhibitor_staff', license: 'unlicensed' });
    const guest = await attendee(false);
    const r = await call('POST', '/portal/leads/scans', staff.access, { scans: [scan(guest.code)] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('forbidden');
  });

  it('another event’s or organization’s attendee badge makes no lead', async () => {
    const t = await team('Strict Co');
    const s = await signIn(t.admin);
    const otherEvent = await conference(a, `Elsewhere ${uniq()}`);
    const elsewhere = await attendee(false, a, otherEvent);
    const r = await call('POST', '/portal/leads/scans', s.access, { scans: [scan(elsewhere.code)] });
    expect((r.body.results as Json[])[0]).toMatchObject({ status: 'refused', lead: null });
    expect(((await call('GET', '/portal/leads', s.access)).body.leads as Json[]).length).toBe(0);
    // A rep of org B cannot be reached through org A's invitation, and the token has no org to pick.
    const bEvent = await conference(b, `B ${uniq()}`);
    const bTeam = await team('B Co', 0, b, bEvent);
    const bSession = await signIn(bTeam.admin, b);
    const aGuest = await attendee(false);
    const cross = await call('POST', '/portal/leads/scans', bSession.access, { scans: [scan(aGuest.code)] });
    expect((cross.body.results as Json[])[0]).toMatchObject({ status: 'refused', lead: null });
  });
});
