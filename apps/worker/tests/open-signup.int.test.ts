import { withoutTenant, withTenant } from '@yayatoh/db';
import { setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { sendAnnouncementCommand } from '@yayatoh/messaging';
import { postgresRateLimitStore } from '@yayatoh/platform';
import { createRateLimiter, RATE_LIMIT_POLICIES } from '@yayatoh/platform/security';
import {
  completeOnboardingCommand,
  getOrganizationQuery,
  inviteMemberCommand,
  onboardingQuery,
  openSignupEnabled,
  setLegalPageCommand,
  signUpOrganization,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { ports, twoOrgs, userCtx } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setOpenSignup } from '../src/open-signup.ts';
import { createSignupCode } from '../src/signup-codes.ts';

const audited: string[] = [];
beforeAll(async () => {
  setPlatformAuditSink(async (a) => void audited.push(a.reason));
  await setOpenSignup({ enabled: false, by: 'staff:test', reason: 'start closed' });
});
afterAll(async () => {
  // Leave the platform as it ships: closed.
  await setOpenSignup({ enabled: false, by: 'staff:test', reason: 'tests done' });
  await closePools();
});

const person = () => {
  const userId = uuidv7();
  return { userId, ctx: createCtx({ actor: { type: 'user', userId } }) };
};
const input = (slug: string, code?: string) => ({
  ...(code === undefined ? {} : { code }),
  slug,
  name: 'Harbor Nights',
  defaultProfile: 'concert',
  acceptTerms: true,
});
const slug = (p: string) => `${p}-${uuidv7().slice(-8)}`;
const key = () => ({ idempotencyKey: uuidv7() });

/** Drizzle wraps driver errors: match the query error and its Postgres cause. */
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(err).not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

async function orgRows(s: string): Promise<number> {
  const rows = await withPlatformReader({ actor: 'staff:test', reason: 'test: count orgs by slug' }, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from tenancy.organizations where slug = ${s}`),
  );
  return rows[0]?.n ?? 0;
}

describe('the open-signup switch (M3.11a)', () => {
  it('is off by default: signing up without a code is refused and creates nothing', async () => {
    expect(await openSignupEnabled()).toBe(false);
    const s = slug('closed');
    await expect(signUpOrganization(person().ctx, input(s), ports)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'signup_closed', field: 'code' },
    });
    await expect(signUpOrganization(person().ctx, input(s, ''), ports)).rejects.toMatchObject({
      details: { reason: 'signup_closed' },
    });
    expect(await orgRows(s)).toBe(0);
  });

  it('a signup code still works while closed, and makes a fully active org', async () => {
    const { code } = await createSignupCode({ maxUses: 1, days: 1, note: 'closed', createdBy: 'staff:test' });
    const p = person();
    const org = await signUpOrganization(p.ctx, input(slug('invited'), code), ports);
    expect(org.status).toBe('active');
    const state = await executeQuery(onboardingQuery, {}, { ...p.ctx, orgId: org.id }, ports);
    expect(state).toMatchObject({ tracked: true, signupMode: 'code', status: 'active', termsCurrent: true });
    expect(state.steps.terms).toBeInstanceOf(Date);
  });

  it('flipping is audited: history with who and why, the access log, idempotent, reason required', async () => {
    audited.length = 0;
    expect(await setOpenSignup({ enabled: true, by: 'staff:alice', reason: 'launch rehearsal' })).toBe(true);
    expect(await openSignupEnabled()).toBe(true);
    // A replay changes nothing and writes no history row.
    expect(await setOpenSignup({ enabled: true, by: 'staff:alice', reason: 'again' })).toBe(false);
    expect(audited.some((r) => r.includes('open self-serve signup: launch rehearsal'))).toBe(true);
    const history = await withPlatformReader({ actor: 'staff:test', reason: 'test: switch history' }, (tx) =>
      tx.execute<{ enabled: boolean; changed_by: string; reason: string }>(
        sql`select enabled, changed_by, reason from platform.flag_changes
            where key = 'open_signup' order by at desc, id desc limit 2`,
      ),
    );
    expect(history[0]).toEqual({ enabled: true, changed_by: 'staff:alice', reason: 'launch rehearsal' });
    expect(history[1]?.reason).not.toBe('again');
    await rejectsWith(setOpenSignup({ enabled: false, by: 'staff:alice', reason: ' ' }), /reason/);
    expect(await openSignupEnabled()).toBe(true);
  });

  it('the runtime role can read the switch only through its function, never flip it', async () => {
    const denied = (q: ReturnType<typeof sql>) =>
      rejectsWith(
        withoutTenant((tx) => tx.execute(q)),
        /permission denied/,
      );
    await denied(sql`select * from platform.flags`);
    await denied(sql`select * from platform.flag_changes`);
    await denied(sql`update platform.flags set enabled = false`);
    await denied(sql`select platform.set_flag('open_signup', false, 'app', 'sneaky')`);
    // platform_reader reads the tables but can't write them directly.
    await rejectsWith(
      withPlatformReader(
        { actor: 'staff:test', reason: 'test: direct write' },
        (tx) => tx.execute(sql`update platform.flags set enabled = false`),
        { callsWritingFunctions: true },
      ),
      /permission denied/,
    );
    expect(await openSignupEnabled()).toBe(true);
  });
});

describe('open signup and onboarding (M3.11a)', () => {
  it('while open, a person creates an org without a code: limited, tracked, terms done', async () => {
    await setOpenSignup({ enabled: true, by: 'staff:test', reason: 'open for this test' });
    const p = person();
    const s = slug('self');
    const org = await signUpOrganization(p.ctx, input(s), ports);
    expect(org).toMatchObject({ slug: s, status: 'limited' });
    const owner = userCtx(p.userId, org.id);
    expect((await executeQuery(getOrganizationQuery, {}, owner, ports)).status).toBe('limited');
    const state = await executeQuery(onboardingQuery, {}, owner, ports);
    expect(state).toMatchObject({
      tracked: true,
      signupMode: 'open',
      status: 'limited',
      termsCurrent: true,
      required: ['terms', 'privacy', 'event'],
      missing: ['privacy', 'event'],
      completedAt: null,
    });
    // A code still makes an active org while open.
    const { code } = await createSignupCode({ maxUses: 1, days: 1, note: 'open', createdBy: 'staff:test' });
    expect((await signUpOrganization(person().ctx, input(slug('coded'), code), ports)).status).toBe('active');
    // System actors still can't sign up.
    await expect(
      signUpOrganization(createCtx({ actor: { type: 'system', name: 'bot' } }), input(slug('bot')), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a limited org builds but cannot message guests until onboarding is complete; progress persists', async () => {
    await setOpenSignup({ enabled: true, by: 'staff:test', reason: 'open for this test' });
    const p = person();
    const org = await signUpOrganization(p.ctx, input(slug('limited')), ports);
    const owner = userCtx(p.userId, org.id);
    const event = await executeCommand(
      createEventCommand,
      {
        name: 'Opening night',
        timezone: 'UTC',
        startsAt: '2027-06-01T19:00:00Z',
        endsAt: '2027-06-01T23:00:00Z',
      },
      owner,
      ports,
    );
    const announce = () =>
      executeCommand(
        sendAnnouncementCommand,
        { eventId: event.id, subject: 'Doors at 7', body: 'See you there.', channels: ['email'] },
        userCtx(p.userId, org.id, key()),
        ports,
      );
    await expect(announce()).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'org_limited' },
    });

    // Finishing before the required steps is refused with what is missing.
    await expect(executeCommand(completeOnboardingCommand, {}, owner, ports)).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'onboarding_incomplete', missing: ['privacy'] },
    });

    await executeCommand(updateOrganizationCommand, { brandColor: '#1A6B5C' }, owner, ports);
    await executeCommand(
      setLegalPageCommand,
      { kind: 'privacy', body: 'We keep guest data safe.' },
      owner,
      ports,
    );
    await executeCommand(
      inviteMemberCommand,
      { email: `mate-${uuidv7()}@example.test`, role: 'manager' },
      owner,
      ports,
    );
    // Removing the privacy notice later doesn't undo the recorded step.
    await executeCommand(setLegalPageCommand, { kind: 'privacy', body: '' }, owner, ports);
    const state = await executeQuery(onboardingQuery, {}, owner, ports);
    expect(state.missing).toEqual([]);
    for (const s of ['terms', 'privacy', 'brand', 'event', 'team'] as const)
      expect(state.steps[s], s).toBeInstanceOf(Date);
    expect(state.steps.payouts).toBeNull();

    // A viewer can't finish it.
    const viewerId = uuidv7();
    await withTenant(createCtx({ orgId: org.id, actor: { type: 'system', name: 'test' } }), (tx) =>
      tx.execute(
        sql`insert into tenancy.memberships (org_id, user_id, role) values (${org.id}, ${viewerId}, 'viewer')`,
      ),
    );
    await expect(
      executeCommand(completeOnboardingCommand, {}, userCtx(viewerId, org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const done = await executeCommand(completeOnboardingCommand, {}, owner, ports);
    expect(done).toMatchObject({ from: 'limited', status: 'active', changed: true });
    expect((await executeQuery(getOrganizationQuery, {}, owner, ports)).status).toBe('active');
    // Idempotent.
    expect(await executeCommand(completeOnboardingCommand, {}, owner, ports)).toMatchObject({
      status: 'active',
      changed: false,
    });
    // Guest messaging is open now (it fails only because nobody has a ticket yet).
    await expect(announce()).rejects.toMatchObject({ details: { reason: 'no_recipients' } });

    const [audit] = await withTenant(
      createCtx({ orgId: org.id, actor: { type: 'system', name: 'test' } }),
      (tx) =>
        tx.execute<{ actor: string; data: { from: string; to: string } }>(
          sql`select actor, data from platform.audit_events where action = 'org.onboarding_complete' order by seq`,
        ),
    );
    expect(audit).toMatchObject({ actor: `user:${p.userId}`, data: { from: 'limited', to: 'active' } });
    const events = await withTenant(
      createCtx({ orgId: org.id, actor: { type: 'system', name: 'test' } }),
      (tx) =>
        tx.execute<{ payload: unknown }>(
          sql`select payload from platform.domain_events where type = 'org.onboarding_completed' and version = 1`,
        ),
    );
    expect(events.map((e) => e.payload)).toEqual([{ orgId: org.id, from: 'limited', to: 'active' }]);
  });

  it('onboarding is per org: another org neither sees nor finishes it', async () => {
    const { a, b } = await twoOrgs();
    const aState = await executeQuery(onboardingQuery, {}, a.ctx(), ports);
    const bState = await executeQuery(onboardingQuery, {}, b.ctx(), ports);
    expect(aState).toMatchObject({ tracked: true, signupMode: 'direct', status: 'active' });
    expect(bState).toMatchObject({ tracked: true, signupMode: 'direct' });
    // A's owner acting on B's org is not a member there.
    await expect(
      executeCommand(completeOnboardingCommand, {}, userCtx(a.ownerId, b.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const rows = await withTenant(
      createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'test' } }),
      (tx) => tx.execute<{ org_id: string }>(sql`select org_id from tenancy.org_onboarding`),
    );
    expect(rows.map((r) => r.org_id)).toEqual([a.org.id]);
  });

  it('closing the switch again refuses new self-serve signups at once', async () => {
    await setOpenSignup({ enabled: false, by: 'staff:test', reason: 'close again' });
    await expect(signUpOrganization(person().ctx, input(slug('late')), ports)).rejects.toMatchObject({
      details: { reason: 'signup_closed' },
    });
  });
});

describe('open-signup abuse limits (M3.11a)', () => {
  it('one account gets 3 self-serve signups a day, whatever the device', async () => {
    const rl = createRateLimiter(postgresRateLimitStore);
    const identity = uuidv7();
    const { limit } = RATE_LIMIT_POLICIES.openSignup.identity;
    expect(limit).toBe(3);
    for (let i = 0; i < limit; i++)
      expect((await rl.check('openSignup', { device: `device-${uuidv7()}`, identity })).allowed).toBe(true);
    const denied = await rl.check('openSignup', { device: `device-${uuidv7()}`, identity });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(60 * 60_000);
    // Another account is unaffected.
    expect((await rl.check('openSignup', { device: `device-${uuidv7()}`, identity: uuidv7() })).allowed).toBe(
      true,
    );
  });

  it('one device gets 5 attempts an hour', async () => {
    const rl = createRateLimiter(postgresRateLimitStore);
    const device = `device${uuidv7().replaceAll('-', '')}`.slice(0, 40);
    for (let i = 0; i < RATE_LIMIT_POLICIES.openSignup.device.limit; i++)
      expect((await rl.check('openSignup', { device, identity: uuidv7() })).allowed).toBe(true);
    expect((await rl.check('openSignup', { device, identity: uuidv7() })).allowed).toBe(false);
  });
});
