import { randomBytes } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { closePools } from '@yayatoh/db/testing';
import { uuidv7 } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createAuth,
  dueImpersonations,
  endImpersonation,
  getImpersonation,
  HANDOFF_TTL_MS,
  hashHandoffCode,
  IMPERSONATION_MAX_MS,
  issueHandoff,
  listImpersonations,
  memoryMailer,
  newHandoffCode,
  startImpersonation,
  twoFactorService,
} from '../src/index.ts';
import { handoffCodes, impersonations, sessions } from '../src/schema.ts';

const BASE = 'http://localhost:3998';
const { mailer } = memoryMailer();
const auth = createAuth({ baseURL: BASE, secret: randomBytes(32).toString('hex'), mailer });
const tf = twoFactorService(auth, { mailer });
const suffix = randomBytes(4).toString('hex');
const TENANT = `harbor-${suffix}.yayatoh.events`;
const OTHER = `lakeside-${suffix}.yayatoh.events`;

afterAll(closePools);

async function newUser(label: string) {
  const email = `${label}-${suffix}-${randomBytes(2).toString('hex')}@example.test`;
  const res = await auth.api.signUpEmail({
    body: { email, password: 'correct horse battery staple', name: label },
  });
  // Signing up signs in on the test host: start with no sessions.
  await identityDatabase().delete(sessions).where(eq(sessions.userId, res.user.id));
  return { id: res.user.id, email };
}

/** Redeem a code as the tenant host's route does (in-process, with that host's Host header). */
async function redeem(code: string, host: string, state: string | null = null) {
  return auth.api.redeemHandoff({
    body: { code, host, state },
    headers: new Headers({ host }),
    asResponse: true,
  });
}

const actions = async (userId: string) => (await tf.events(userId, 50)).map((e) => e.action);
const refusals = async (userId: string) =>
  (await tf.events(userId, 50)).filter((e) => e.action === 'handoff.refused').map((e) => e.data.reason);

describe('central login: handoff codes (M1.2d)', () => {
  it('a code signs the person in on its own host once; the session is bound to that host', async () => {
    const u = await newUser('handoff');
    const state = newHandoffCode();
    const { code, expiresAt } = await issueHandoff({
      userId: u.id,
      host: TENANT,
      returnPath: '/events/gala',
      state,
    });
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(HANDOFF_TTL_MS);
    const res = await redeem(code, TENANT, state);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ returnPath: '/events/gala', userId: u.id });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('yy.session='));
    expect(cookie).toBeTruthy();
    // Host-only: no Domain attribute, so the browser sends it to this host alone.
    expect(cookie).not.toMatch(/domain=/i);
    const rows = await identityDatabase()
      .select({ host: sessions.host, imp: sessions.impersonationId })
      .from(sessions)
      .where(eq(sessions.userId, u.id));
    expect(rows).toEqual([{ host: TENANT, imp: null }]);
    expect(await actions(u.id)).toContain('handoff.redeemed');
  });

  it('only a hash is stored', async () => {
    const u = await newUser('hash');
    const { code } = await issueHandoff({ userId: u.id, host: TENANT, returnPath: '/' });
    const [row] = await identityDatabase().select().from(handoffCodes).where(eq(handoffCodes.userId, u.id));
    expect(row?.codeHash).toBe(hashHandoffCode(code));
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('a replayed code is refused and audited', async () => {
    const u = await newUser('replay');
    const { code } = await issueHandoff({ userId: u.id, host: TENANT, returnPath: '/' });
    expect((await redeem(code, TENANT)).status).toBe(200);
    const again = await redeem(code, TENANT);
    expect(again.status).toBe(400);
    expect(again.headers.getSetCookie().some((c) => c.startsWith('yy.session=') && !/=;/.test(c))).toBe(
      false,
    );
    expect(await refusals(u.id)).toContain('used');
  });

  it('a code for another host is refused, audited, and spent (it no longer works on its own host)', async () => {
    const u = await newUser('foreign');
    const { code } = await issueHandoff({ userId: u.id, host: TENANT, returnPath: '/' });
    expect((await redeem(code, OTHER)).status).toBe(400);
    expect((await redeem(code, TENANT)).status).toBe(400);
    expect(await refusals(u.id)).toEqual(expect.arrayContaining(['wrong_host', 'used']));
    const rows = await identityDatabase().select().from(sessions).where(eq(sessions.userId, u.id));
    expect(rows).toHaveLength(0);
  });

  it('a code older than 60 seconds is refused', async () => {
    const u = await newUser('expired');
    const { code } = await issueHandoff({
      userId: u.id,
      host: TENANT,
      returnPath: '/',
      now: new Date(Date.now() - HANDOFF_TTL_MS - 1000),
    });
    expect((await redeem(code, TENANT)).status).toBe(400);
    expect(await refusals(u.id)).toContain('expired');
  });

  it('a code bound to a sign-in state needs that browser’s state', async () => {
    const u = await newUser('state');
    const state = newHandoffCode();
    const a = await issueHandoff({ userId: u.id, host: TENANT, returnPath: '/', state });
    expect((await redeem(a.code, TENANT, null)).status).toBe(400);
    const b = await issueHandoff({ userId: u.id, host: TENANT, returnPath: '/', state });
    expect((await redeem(b.code, TENANT, newHandoffCode())).status).toBe(400);
    expect(await refusals(u.id)).toEqual(['wrong_state', 'wrong_state']);
  });

  it('unknown and malformed codes are refused without a lookup hit', async () => {
    expect((await redeem(newHandoffCode(), TENANT)).status).toBe(400);
    expect((await redeem('not-a-code', TENANT)).status).toBe(400);
  });

  it('the return path never leaves the host', async () => {
    const u = await newUser('path');
    const { code } = await issueHandoff({ userId: u.id, host: TENANT, returnPath: '//evil.example/x' });
    const res = await redeem(code, TENANT);
    expect(await res.json()).toMatchObject({ returnPath: '/' });
  });

  it('is closed over HTTP (the app’s own route redeems in-process)', async () => {
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/handoff/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ code: newHandoffCode(), host: TENANT }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('a sign-in on a host binds its session to that host', async () => {
    const u = await newUser('bound');
    await auth.api.signInEmail({
      body: { email: u.email, password: 'correct horse battery staple' },
      headers: new Headers({ host: 'localhost:3998' }),
    });
    const rows = await identityDatabase()
      .select({ host: sessions.host })
      .from(sessions)
      .where(eq(sessions.userId, u.id));
    expect(rows.map((r) => r.host)).toContain('localhost:3998');
  });
});

describe('staff impersonation records (M1.2e)', () => {
  const start = async (label: string, now = new Date()) => {
    const staff = await newUser(`${label}-staff`);
    const member = await newUser(`${label}-member`);
    const orgId = uuidv7();
    const r = await startImpersonation({
      id: uuidv7(),
      staffUserId: staff.id,
      userId: member.id,
      orgId,
      reason: '  Ticket 4312: seating help ',
      returnUrl: 'http://localhost:3001/tenants/x?done=impersonation_ended',
      appHost: 'localhost:3998',
      returnPath: '/o/test',
      now,
    });
    return { staff, member, orgId, ...r };
  };

  it('starts for one hour with a reason, audited for both people, with a code for the app host', async () => {
    const { staff, member, impersonation, code, orgId } = await start('imp');
    expect(impersonation.reason).toBe('Ticket 4312: seating help');
    expect(impersonation.expiresAt.getTime() - impersonation.startedAt.getTime()).toBe(IMPERSONATION_MAX_MS);
    expect(await actions(staff.id)).toContain('impersonation.started');
    expect(await actions(member.id)).toContain('impersonation.started_as_you');

    const res = await redeem(code, 'localhost:3998');
    expect(res.status).toBe(200);
    // The session belongs to the impersonation, ends with it, and is never refreshed.
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('yy.dont_remember='))).toBe(true);
    const [row] = await identityDatabase()
      .select({ imp: sessions.impersonationId, expiresAt: sessions.expiresAt, host: sessions.host })
      .from(sessions)
      .where(eq(sessions.userId, member.id));
    expect(row).toMatchObject({ imp: impersonation.id, host: 'localhost:3998' });
    expect(row?.expiresAt.getTime()).toBe(impersonation.expiresAt.getTime());

    const list = await listImpersonations(orgId);
    expect(list[0]).toMatchObject({ id: impersonation.id, staffName: 'imp-staff', memberName: 'imp-member' });
  });

  it('ending it deletes its session; ending twice changes nothing; its code no longer works', async () => {
    const { impersonation, code, member, staff } = await start('end');
    expect((await redeem(code, 'localhost:3998')).status).toBe(200);
    const ended = await endImpersonation(impersonation.id, 'ended');
    expect(ended).toMatchObject({ id: impersonation.id });
    expect(await endImpersonation(impersonation.id, 'ended')).toBeNull();
    expect((await getImpersonation(impersonation.id))?.endedReason).toBe('ended');
    const rows = await identityDatabase().select().from(sessions).where(eq(sessions.userId, member.id));
    expect(rows).toHaveLength(0);
    expect(await actions(staff.id)).toContain('impersonation.ended');

    const late = await start('late');
    await endImpersonation(late.impersonation.id, 'ended');
    expect((await redeem(late.code, 'localhost:3998')).status).toBe(400);
    expect(await refusals(late.member.id)).toContain('ended');
  });

  it('after its hour it is due for ending (the worker records the end)', async () => {
    const old = await start('due', new Date(Date.now() - IMPERSONATION_MAX_MS - 60_000));
    const due = await dueImpersonations(new Date());
    expect(due.map((d) => d.id)).toContain(old.impersonation.id);
    // Its code is long expired too.
    expect((await redeem(old.code, 'localhost:3998')).status).toBe(400);
    await endImpersonation(old.impersonation.id, 'expired');
    const [row] = await identityDatabase()
      .select({ reason: impersonations.endedReason })
      .from(impersonations)
      .where(eq(impersonations.id, old.impersonation.id));
    expect(row?.reason).toBe('expired');
  });

  it('refuses staff acting as themselves and an empty reason', async () => {
    const staff = await newUser('self');
    const base = {
      id: uuidv7(),
      staffUserId: staff.id,
      orgId: uuidv7(),
      returnUrl: 'http://localhost:3001/',
      appHost: 'localhost:3998',
      returnPath: '/o/x',
    };
    await expect(startImpersonation({ ...base, userId: staff.id, reason: 'x' })).rejects.toThrow(
      /themselves/,
    );
    const other = await newUser('other');
    await expect(startImpersonation({ ...base, userId: other.id, reason: '   ' })).rejects.toThrow(/reason/);
  });
});
