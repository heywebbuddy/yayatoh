import { randomBytes } from 'node:crypto';
import {
  createAuth,
  isPlatformStaff,
  memoryMailer,
  trustDevice,
  trustedDeviceCookie,
  twoFactorService,
  verifySignInChallenge,
} from '@yayatoh/auth';
import { secretKey, totp } from '@yayatoh/auth/totp';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStaff } from '../src/staff.ts';

/**
 * M6.5a acceptance: single sign-on never replaces the authenticator code for platform staff (D14),
 * and an SSO session from the web never opens the staff console.
 */
beforeAll(() => setPlatformAuditSink(databaseAuditSink));
afterAll(closePools);

const secret = randomBytes(32).toString('hex');
const { mailer } = memoryMailer();
const web = createAuth({ baseURL: 'http://localhost:3995', secret, mailer });
const admin = createAuth({ baseURL: 'http://localhost:3994', secret, mailer, cookieNamespace: 'admin' });
const tf = twoFactorService(web, { mailer });
const PASSWORD = 'correct horse battery staple';
const ORG = uuidv7();

function jar() {
  const cookies = new Map<string, string>();
  return {
    take(res: Response) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair, ...attrs] = raw.split(';');
        const at = (pair ?? '').indexOf('=');
        const name = (pair ?? '').slice(0, at).trim();
        const value = (pair ?? '').slice(at + 1).trim();
        if (attrs.some((a) => /max-age=0/i.test(a)) || value === '') cookies.delete(name);
        else cookies.set(name, value);
      }
      return res;
    },
    names: () => [...cookies.keys()],
    headers: (extra: Record<string, string> = {}) =>
      new Headers({ cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra }),
  };
}

async function person(label: string, opts: { staff?: boolean; twoFactor?: boolean }) {
  const email = `${label}-${randomBytes(4).toString('hex')}@example.test`;
  const res = await web.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  const c = await web.$context;
  await c.internalAdapter.updateUser(res.user.id, { emailVerified: true });
  // Sign-up signs in; these tests start signed out.
  const made = await c.internalAdapter.listSessions(res.user.id);
  await c.internalAdapter.deleteSessions(made.map((m) => m.token));
  let code = () => '';
  if (opts.twoFactor) {
    const key = `S${randomBytes(12).toString('hex')}`.slice(0, 20);
    await tf.begin(res.user.id, email, { secret: key });
    await tf.confirm(res.user.id, totp(secretKey(key), Date.now() - 30_000));
    code = () => totp(secretKey(key), Date.now());
  }
  if (opts.staff) await setStaff({ email, role: 'support', by: 'staff:test' });
  return { id: res.user.id, email, code };
}

const ssoSession = (userId: string) =>
  web.api.ssoSession({
    body: { userId, orgId: ORG },
    headers: new Headers({ host: 'localhost:3995' }),
    asResponse: true,
  });

describe('SSO and platform staff (M6.5a, D14)', () => {
  it('staff without two-step verification are refused: no session, no challenge', async () => {
    const s = await person('staff-no-2fa', { staff: true });
    expect(await isPlatformStaff(s.id)).toBe(true);
    const res = await ssoSession(s.id);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('STAFF_TWO_FACTOR_REQUIRED');
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await (await web.$context).internalAdapter.listSessions(s.id)).toEqual([]);
  });

  it('staff with an authenticator still answer it after the IdP; the session is bound to the org', async () => {
    const s = await person('staff-2fa', { staff: true, twoFactor: true });
    const j = jar();
    const res = j.take(await ssoSession(s.id));
    expect(await res.json()).toEqual({ challenge: true });
    expect(j.names().some((n) => n.endsWith('session_token'))).toBe(false);
    expect(await (await web.$context).internalAdapter.listSessions(s.id)).toEqual([]);
    // A browser the person trusts doesn't skip a staff member's code.
    const trusted = await trustDevice({ userId: s.id, host: 'localhost:3995', userAgent: null });
    const skip = await web.api.redeemTrustedDevice({
      body: { cookie: trusted.cookie, host: 'localhost:3995' },
      headers: j.headers({
        cookie: `${j.headers().get('cookie')}; ${trustedDeviceCookie(false)}=${trusted.cookie}`,
      }),
    });
    expect(skip).toEqual({ ok: false });
    // The code: a session bound to the SSO org.
    const ok = await verifySignInChallenge(web, j.headers(), { kind: 'totp', code: s.code() });
    expect(ok).toMatchObject({ ok: true, userId: s.id });
    const sessions = await (await web.$context).internalAdapter.listSessions(s.id);
    expect(sessions).toHaveLength(1);
    expect((sessions[0] as { ssoOrgId?: string }).ssoOrgId).toBe(ORG);
  });

  it('a non-staff person without two-step verification gets an org-bound session at once', async () => {
    const p = await person('member', {});
    const j = jar();
    const res = j.take(await ssoSession(p.id));
    expect(await res.json()).toEqual({ challenge: false });
    const s = await web.api.getSession({ headers: j.headers() });
    expect(s?.user.id).toBe(p.id);
    expect((s?.session as { ssoOrgId?: string } | undefined)?.ssoOrgId).toBe(ORG);
    // The staff console never accepts a web session (its own cookie): SSO can't open it.
    expect(await admin.api.getSession({ headers: j.headers() })).toBeNull();
  });

  it('a non-staff person with two-step verification answers the code too, and a trusted device binds the org', async () => {
    const p = await person('member-2fa', { twoFactor: true });
    const j = jar();
    expect(await j.take(await ssoSession(p.id)).json()).toEqual({ challenge: true });
    const trusted = await trustDevice({ userId: p.id, host: 'localhost:3995', userAgent: null });
    const r = await web.api.redeemTrustedDevice({
      body: { cookie: trusted.cookie, host: 'localhost:3995' },
      headers: j.headers(),
      asResponse: true,
    });
    j.take(r);
    expect(await r.json()).toMatchObject({ ok: true, userId: p.id });
    const s = await web.api.getSession({ headers: j.headers() });
    expect((s?.session as { ssoOrgId?: string } | undefined)?.ssoOrgId).toBe(ORG);
  });

  it('the SSO session endpoint is closed over HTTP', async () => {
    const res = await web.handler(
      new Request('http://localhost:3995/api/auth/sso/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3995' },
        body: JSON.stringify({ userId: uuidv7(), orgId: ORG }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
