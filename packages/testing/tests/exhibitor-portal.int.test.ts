import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  createPortalSession,
  type EventDto,
  endPortalSession,
  eventRoleGrantsTx,
  portalCtx,
  portalPrincipalBySession,
  portalSiteToken,
  resendPortalInvitations,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { listMediaQuery, uploadExhibitorLogoFromPortal } from '@yayatoh/media';
import { testPng } from '@yayatoh/media/testing';
import { postgresRateLimitStore, recentEventsTx } from '@yayatoh/platform';
import { createRateLimiter } from '@yayatoh/platform/security';
import {
  assignBoothCommand,
  boothPlanQuery,
  createExhibitorCommand,
  createSpeakerCommand,
  decideProfileChangeCommand,
  deleteBoothCommand,
  deleteExhibitorCommand,
  type ExhibitorDto,
  exhibitorPortalAdminQuery,
  exhibitorPortalQuery,
  inviteExhibitorMemberCommand,
  inviteSpeakerCommand,
  PublicExhibitorMapDto,
  portalInviteStaffCommand,
  portalRevokeStaffCommand,
  portalSaveProfileCommand,
  publicExhibitorMap,
  publicProgram,
  resendExhibitorInviteCommand,
  revokeExhibitorMemberCommand,
  saveBoothCommand,
  saveExhibitorListingCommand,
  saveExhibitorSettingsCommand,
  speakerPortalQuery,
  unassignBoothCommand,
} from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let acme: ExhibitorDto;
let globex: ExhibitorDto;

const HOST = 'portal.test';
const limiter = createRateLimiter(postgresRateLimitStore);
const limits = () => ({ limiter, subject: { device: `dev${uuidv7().replace(/-/g, '')}`, ip: null } });

async function rejects(p: Promise<unknown>, code: string, reason?: string) {
  try {
    await p;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    expect(err.code).toBe(code);
    if (reason) expect((err.details as { reason?: string } | undefined)?.reason).toBe(reason);
    return;
  }
  throw new Error(`expected ${code}`);
}

/** A browser signed in to the portal as a portal account (M5.3a's one sign-in flow). */
async function session(orgId: string, accountId: string) {
  const s = await createPortalSession({ orgId, accountId, host: HOST });
  const principal = await portalPrincipalBySession(s.token, HOST);
  if (!principal) throw new Error('no principal');
  return { principal, token: s.token, ctx: portalCtx(principal) };
}

/** Invite someone (organizer) and sign them in; returns their principal, context and session. */
async function signedIn(
  f: OrgFixture,
  eventId: string,
  exhibitorId: string,
  email: string,
  role: 'exhibitor_admin' | 'exhibitor_staff' = 'exhibitor_admin',
) {
  const invited = await executeCommand(
    inviteExhibitorMemberCommand,
    { eventId, exhibitorId, email, role },
    f.ctx(),
    ports,
  );
  return { ...(await session(f.org.id, invited.member.id)), memberId: invited.member.id };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await executeCommand(
    createEventCommand,
    {
      name: `Expo ${a.org.slug}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2030-05-01T14:00:00Z',
      endsAt: '2030-05-02T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  acme = await executeCommand(
    createExhibitorCommand,
    { eventId: ev.id, name: 'Acme Robotics' },
    a.ctx(),
    ports,
  );
  globex = await executeCommand(createExhibitorCommand, { eventId: ev.id, name: 'Globex' }, a.ctx(), ports);
});

afterAll(async () => {
  await closePools();
});

describe('exhibitor portal sign-in (M5.4a on the M5.3a portal accounts, P5-7)', () => {
  it('an invitation is a portal account: one event role, emailed through the outbox; revoking ends it', async () => {
    const invited = await executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: ev.id, exhibitorId: acme.id, email: 'Lead@acme.example', role: 'exhibitor_admin' },
      a.ctx(),
      ports,
    );
    expect(invited.member).toMatchObject({ email: 'lead@acme.example', status: 'pending' });
    // The invitation is emailed by the portal invite mailer (no token in the event).
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['portal.account_invited'], 3_600_000),
    );
    const inv = events.find(
      (e) => e.type === 'portal.account_invited' && e.aggregateId === invited.member.id,
    );
    expect(inv?.payload).toMatchObject({ role: 'exhibitor_admin', eventId: ev.id });
    expect(JSON.stringify(inv?.payload)).not.toContain('~');

    const { principal, token, ctx } = await session(a.org.id, invited.member.id);
    expect(principal).toMatchObject({
      orgId: a.org.id,
      eventId: ev.id,
      role: 'exhibitor_admin',
      subjectKind: 'exhibitor',
      subjectId: acme.id,
    });
    const view = await executeQuery(exhibitorPortalQuery, {}, ctx, ports);
    expect(view.exhibitor.name).toBe('Acme Robotics');
    expect(view.staff?.members.map((m) => [m.email, m.status])).toEqual([['lead@acme.example', 'active']]);
    // The session works only on the host that issued it.
    expect(await portalPrincipalBySession(token, 'other.test')).toBeNull();

    await executeCommand(
      revokeExhibitorMemberCommand,
      { eventId: ev.id, memberId: invited.member.id },
      a.ctx(),
      ports,
    );
    expect(await portalPrincipalBySession(token, HOST)).toBeNull();
    await rejects(executeQuery(exhibitorPortalQuery, {}, ctx, ports), 'forbidden');
  });

  it('the event’s sign-in page emails only live invitations, with the same answer for anyone', async () => {
    const invited = await executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: ev.id, exhibitorId: globex.id, email: 'ops@globex.example', role: 'exhibitor_admin' },
      a.ctx(),
      ports,
    );
    const site = portalSiteToken(a.org.id, ev.id);
    const ask = (email: string, token = site) =>
      resendPortalInvitations(
        { siteToken: token, email, appOrigin: 'https://app.test', locale: 'en' },
        limits(),
      );
    const r = await ask('OPS@globex.example');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.invites).toHaveLength(1);
    expect(r.invites[0]).toMatchObject({ email: 'ops@globex.example', role: 'exhibitor_admin' });
    expect(r.invites[0]?.url).toContain(`/event-portal/invite/${a.org.id}~${invited.member.id}~`);
    // An unknown address gets the same answer with nothing to send.
    expect(await ask('nobody@example.com')).toMatchObject({ status: 'ok', invites: [] });
    // A forged or other-org token is refused.
    expect((await ask('ops@globex.example', `${b.org.id}~${ev.id}~${'x'.repeat(43)}`)).status).toBe(
      'refused',
    );
    expect(
      await resendPortalInvitations(
        {
          siteToken: portalSiteToken(b.org.id, ev.id),
          email: 'ops@globex.example',
          appOrigin: 'x',
          locale: 'en',
        },
        limits(),
      ),
    ).toMatchObject({ status: 'ok', invites: [] });
    // A revoked invitation is never sent again.
    await executeCommand(
      revokeExhibitorMemberCommand,
      { eventId: ev.id, memberId: invited.member.id },
      a.ctx(),
      ports,
    );
    expect(await ask('ops@globex.example')).toMatchObject({ status: 'ok', invites: [] });
  });

  it('signing out ends only that browser', async () => {
    const one = await signedIn(a, ev.id, globex.id, 'second@globex.example');
    const two = await session(a.org.id, one.memberId);
    await endPortalSession(one.token);
    expect(await portalPrincipalBySession(one.token, HOST)).toBeNull();
    // Another browser of the same account is still signed in.
    expect(await portalPrincipalBySession(two.token, HOST)).toMatchObject({ accountId: one.memberId });
    await expect(executeQuery(exhibitorPortalQuery, {}, two.ctx, ports)).resolves.toBeTruthy();
  });

  it('speaker and exhibitor principals cannot reach each other’s portals', async () => {
    const speaker = await executeCommand(
      createSpeakerCommand,
      { eventId: ev.id, name: 'Sam Speaker' },
      a.ctx(),
      ports,
    );
    const invited = await executeCommand(
      inviteSpeakerCommand,
      { eventId: ev.id, speakerId: speaker.id, email: 'sam@speaker.example' },
      a.ctx(),
      ports,
    );
    const sp = await session(a.org.id, invited.accountId);
    const ex = await signedIn(a, ev.id, acme.id, 'cross@acme.example');
    await expect(executeQuery(speakerPortalQuery, {}, sp.ctx, ports)).resolves.toBeTruthy();
    await rejects(executeQuery(exhibitorPortalQuery, {}, sp.ctx, ports), 'forbidden');
    await rejects(executeCommand(portalSaveProfileCommand, { name: 'Hijack' }, sp.ctx, ports), 'forbidden');
    await rejects(executeQuery(speakerPortalQuery, {}, ex.ctx, ports), 'forbidden');
    // A context claiming the other role for the same account is refused in the transaction.
    const forged = (accountId: string, role: 'speaker' | 'exhibitor_admin'): Ctx =>
      createCtx({ orgId: a.org.id, actor: { type: 'portal', accountId, role } });
    await rejects(
      executeQuery(exhibitorPortalQuery, {}, forged(invited.accountId, 'exhibitor_admin'), ports),
      'forbidden',
    );
    await rejects(executeQuery(speakerPortalQuery, {}, forged(ex.memberId, 'speaker'), ports), 'forbidden');
  });
});

describe('an exhibitor admin cannot see or touch another exhibitor (M5.4a acceptance)', () => {
  it('guessed ids and other orgs are all refused', async () => {
    const mine = await signedIn(a, ev.id, acme.id, 'guard@acme.example');
    const theirs = await signedIn(a, ev.id, globex.id, 'guard@globex.example');
    const staff = await executeCommand(
      portalInviteStaffCommand,
      { email: 'staff-guard@globex.example' },
      theirs.ctx,
      ports,
    );
    // Another exhibitor's people can't be revoked (they look unknown).
    for (const memberId of [theirs.memberId, staff.member.id, uuidv7()])
      await rejects(executeCommand(portalRevokeStaffCommand, { memberId }, mine.ctx, ports), 'not_found');
    // The same account in another org's context is refused.
    await rejects(
      executeQuery(exhibitorPortalQuery, {}, { ...mine.ctx, orgId: b.org.id }, ports),
      'forbidden',
    );
    // What they do see is only their own exhibitor.
    const view = await executeQuery(exhibitorPortalQuery, {}, mine.ctx, ports);
    expect(JSON.stringify(view)).not.toContain('Globex');
    expect(JSON.stringify(view)).not.toContain('guard@globex.example');
  });

  it('exhibitor tasks (M5.3a generic task model) show only to their own exhibitor', async () => {
    const mine = await signedIn(a, ev.id, acme.id, 'tasks@acme.example');
    const theirs = await signedIn(a, ev.id, globex.id, 'tasks@globex.example');
    const title = `Upload the booth insurance ${uuidv7()}`;
    await withTenant(systemCtx(a.org.id), async (tx) => {
      const [t] = await tx.execute<{ id: string }>(sql`
        insert into program.portal_tasks (org_id, event_id, subject_kind, kind, title, due_at, created_by)
        values (${a.org.id}, ${ev.id}, 'exhibitor', 'upload', ${title}, '2030-04-20T12:00:00Z', 'fixture')
        returning id`);
      await tx.execute(sql`
        insert into program.portal_task_assignees (org_id, task_id, event_id, subject_id)
        values (${a.org.id}, ${t?.id}, ${ev.id}, ${acme.id})`);
    });
    const view = await executeQuery(exhibitorPortalQuery, {}, mine.ctx, ports);
    expect(view.tasks.filter((x) => x.title === title)).toEqual([
      expect.objectContaining({ kind: 'upload', status: 'open', completedAt: null }),
    ]);
    const other = await executeQuery(exhibitorPortalQuery, {}, theirs.ctx, ports);
    expect(other.tasks.some((x) => x.title === title)).toBe(false);
  });

  it('staff see their exhibitor but not the staff list, and cannot invite or edit', async () => {
    const staff = await signedIn(a, ev.id, acme.id, 'booth@acme.example', 'exhibitor_staff');
    const view = await executeQuery(exhibitorPortalQuery, {}, staff.ctx, ports);
    expect(view.role).toBe('exhibitor_staff');
    expect(view.staff).toBeNull();
    await rejects(
      executeCommand(portalInviteStaffCommand, { email: 'x@acme.example' }, staff.ctx, ports),
      'forbidden',
    );
    await rejects(
      executeCommand(portalSaveProfileCommand, { name: 'Hacked' }, staff.ctx, ports),
      'forbidden',
    );
    // A staff account claiming the admin role is refused in the transaction.
    const claimed = createCtx({
      orgId: a.org.id,
      actor: { type: 'portal', accountId: staff.memberId, role: 'exhibitor_admin' },
    });
    await rejects(executeCommand(portalSaveProfileCommand, { name: 'Hacked' }, claimed, ports), 'forbidden');
  });

  it('the organizer side needs events:write; a viewer is refused', async () => {
    await rejects(
      executeCommand(
        inviteExhibitorMemberCommand,
        {
          eventId: ev.id,
          exhibitorId: acme.id,
          email: 'v@acme.example',
          role: 'exhibitor_admin',
        },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    await rejects(
      executeCommand(
        saveExhibitorSettingsCommand,
        { eventId: ev.id, defaultStaffAllowance: 9, approvalRequired: false },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    await rejects(
      executeCommand(
        saveBoothCommand,
        { eventId: ev.id, number: 'V1', x: 0, y: 0, width: 300, height: 300 },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    // Another org can't reach this event's exhibitors at all.
    await rejects(executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
    await rejects(
      executeCommand(
        inviteExhibitorMemberCommand,
        {
          eventId: ev.id,
          exhibitorId: acme.id,
          email: 'b@acme.example',
          role: 'exhibitor_admin',
        },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
  });
});

describe('staff invitations stop at the allowance (M5.4a acceptance)', () => {
  it('pending invites count, revoke frees a place, the exhibitor override wins', async () => {
    const x = await executeCommand(
      createExhibitorCommand,
      { eventId: ev.id, name: 'Initech' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      saveExhibitorSettingsCommand,
      { eventId: ev.id, defaultStaffAllowance: 2, approvalRequired: false },
      a.ctx(),
      ports,
    );
    const admin = await signedIn(a, ev.id, x.id, 'boss@initech.example');
    const invite = (email: string) => executeCommand(portalInviteStaffCommand, { email }, admin.ctx, ports);
    const first = await invite('one@initech.example');
    await invite('two@initech.example');
    await rejects(invite('three@initech.example'), 'invalid_state', 'allowance_reached');
    // The same address twice is a conflict, not a second place.
    await rejects(invite('ONE@initech.example'), 'conflict', 'already_invited');
    await executeCommand(portalRevokeStaffCommand, { memberId: first.member.id }, admin.ctx, ports);
    await invite('three@initech.example');
    await rejects(invite('four@initech.example'), 'invalid_state', 'allowance_reached');
    // The organizer raises this exhibitor's own allowance.
    await executeCommand(
      saveExhibitorListingCommand,
      { eventId: ev.id, exhibitorId: x.id, listed: true, categories: [], links: [], staffAllowance: 3 },
      a.ctx(),
      ports,
    );
    await invite('four@initech.example');
    const view = await executeQuery(exhibitorPortalQuery, {}, admin.ctx, ports);
    expect(view.staff?.allowance).toEqual({ allowance: 3, used: 3, left: 0 });
    // Admins don't take staff places.
    expect(view.staff?.members.filter((m) => m.role === 'exhibitor_admin')).toHaveLength(1);
  });

  it('under 12 concurrent invites exactly the allowance succeeds', async () => {
    const x = await executeCommand(
      createExhibitorCommand,
      { eventId: ev.id, name: 'Umbrella' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      saveExhibitorListingCommand,
      { eventId: ev.id, exhibitorId: x.id, listed: true, categories: [], links: [], staffAllowance: 4 },
      a.ctx(),
      ports,
    );
    const admin = await signedIn(a, ev.id, x.id, 'boss@umbrella.example');
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        executeCommand(portalInviteStaffCommand, { email: `s${i}@umbrella.example` }, admin.ctx, ports),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    for (const r of results)
      if (r.status === 'rejected')
        expect((r.reason as { details?: { reason?: string } }).details?.reason).toBe('allowance_reached');
    const admin2 = await executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(admin2.exhibitors.find((e) => e.exhibitorId === x.id)?.staff).toEqual({
      allowance: 4,
      used: 4,
      left: 0,
    });
    // Each successful invite emitted one versioned event.
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['program.exhibitor.staff_invited'], 3_600_000),
    );
    const mine = events.filter((e) => (e.payload as { exhibitorId?: string }).exhibitorId === x.id);
    expect(mine).toHaveLength(4);
    expect(mine.every((e) => e.version === 1)).toBe(true);
  });
});

describe('profile edits and organizer approval', () => {
  it('without approval an edit applies at once; with approval it waits, then applies or not', async () => {
    const x = await executeCommand(createExhibitorCommand, { eventId: ev.id, name: 'Hooli' }, a.ctx(), ports);
    const admin = await signedIn(a, ev.id, x.id, 'boss@hooli.example');
    await executeCommand(
      saveExhibitorSettingsCommand,
      { eventId: ev.id, defaultStaffAllowance: 2, approvalRequired: false },
      a.ctx(),
      ports,
    );
    const direct = await executeCommand(
      portalSaveProfileCommand,
      {
        name: 'Hooli XYZ',
        description: 'We *compress*.',
        websiteUrl: 'https://hooli.example',
        links: [{ label: 'Jobs', url: 'https://hooli.example/jobs' }],
        categories: ['Software', 'software', 'AI'],
      },
      admin.ctx,
      ports,
    );
    expect(direct.status).toBe('applied');
    let view = await executeQuery(exhibitorPortalQuery, {}, admin.ctx, ports);
    expect(view.exhibitor).toMatchObject({ name: 'Hooli XYZ', categories: ['software', 'AI'] });
    expect(view.exhibitor.description).toBe('We *compress*.');
    await rejects(
      executeCommand(
        portalSaveProfileCommand,
        { name: 'Hooli', links: [{ label: 'x', url: 'javascript:alert(1)' }] },
        admin.ctx,
        ports,
      ),
      'validation_failed',
    );

    await executeCommand(
      saveExhibitorSettingsCommand,
      { eventId: ev.id, defaultStaffAllowance: 2, approvalRequired: true },
      a.ctx(),
      ports,
    );
    const waiting = await executeCommand(
      portalSaveProfileCommand,
      { name: 'Hooli Pending', description: 'New copy' },
      admin.ctx,
      ports,
    );
    expect(waiting.status).toBe('pending');
    view = await executeQuery(exhibitorPortalQuery, {}, admin.ctx, ports);
    expect(view.exhibitor.name).toBe('Hooli XYZ');
    expect(view.pendingChange?.name).toBe('Hooli Pending');
    // The public program still shows the approved name only.
    const before = await publicProgram({ orgId: a.org.id, eventId: ev.id });
    expect(before.exhibitors.map((e) => e.name)).toContain('Hooli XYZ');
    expect(JSON.stringify(before)).not.toContain('Hooli Pending');

    const row = (
      await executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, a.ctx(), ports)
    ).exhibitors.find((e) => e.exhibitorId === x.id);
    expect(row?.pendingChange?.proposed.name).toBe('Hooli Pending');
    await rejects(
      executeCommand(
        decideProfileChangeCommand,
        { eventId: ev.id, changeId: row?.pendingChange?.id ?? '', decision: 'approve' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
      'forbidden',
    );
    await executeCommand(
      decideProfileChangeCommand,
      { eventId: ev.id, changeId: row?.pendingChange?.id ?? '', decision: 'approve' },
      a.ctx(),
      ports,
    );
    view = await executeQuery(exhibitorPortalQuery, {}, admin.ctx, ports);
    expect(view.exhibitor.name).toBe('Hooli Pending');
    expect(view.pendingChange).toBeNull();

    await executeCommand(portalSaveProfileCommand, { name: 'Hooli Rejected' }, admin.ctx, ports);
    const again = (
      await executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, a.ctx(), ports)
    ).exhibitors.find((e) => e.exhibitorId === x.id);
    await executeCommand(
      decideProfileChangeCommand,
      {
        eventId: ev.id,
        changeId: again?.pendingChange?.id ?? '',
        decision: 'reject',
        reason: 'Name is too long',
      },
      a.ctx(),
      ports,
    );
    view = await executeQuery(exhibitorPortalQuery, {}, admin.ctx, ports);
    expect(view.exhibitor.name).toBe('Hooli Pending');
    await executeCommand(
      saveExhibitorSettingsCommand,
      { eventId: ev.id, defaultStaffAllowance: 2, approvalRequired: false },
      a.ctx(),
      ports,
    );
  });

  it('resending an invitation issues a new version (older links stop); a revoked one cannot be resent', async () => {
    const invited = await executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: ev.id, exhibitorId: acme.id, email: 'late@acme.example', role: 'exhibitor_admin' },
      a.ctx(),
      ports,
    );
    const version = async () =>
      withTenant(systemCtx(a.org.id), async (tx) => {
        const rows = await tx.execute<{ invite_version: number }>(
          sql`select invite_version from events.portal_accounts where id = ${invited.member.id}`,
        );
        return rows[0]?.invite_version;
      });
    expect(await version()).toBe(1);
    await executeCommand(
      resendExhibitorInviteCommand,
      { eventId: ev.id, memberId: invited.member.id },
      a.ctx(),
      ports,
    );
    expect(await version()).toBe(2);
    await executeCommand(
      revokeExhibitorMemberCommand,
      { eventId: ev.id, memberId: invited.member.id },
      a.ctx(),
      ports,
    );
    await rejects(
      executeCommand(
        resendExhibitorInviteCommand,
        { eventId: ev.id, memberId: invited.member.id },
        a.ctx(),
        ports,
      ),
      'not_found',
    );
  });
});

describe('booths on the floor plan', () => {
  it('assigns with one primary and co-exhibitors, warns on conflicts, and emits booth.assigned', async () => {
    const plan = await executeCommand(
      saveBoothCommand,
      { eventId: ev.id, number: 'B12', category: 'Robotics', x: 0, y: 0, width: 300, height: 300 },
      a.ctx(),
      ports,
    );
    const b12 = plan.booths.find((x) => x.number === 'B12');
    if (!b12) throw new Error('no booth');
    await rejects(
      executeCommand(
        saveBoothCommand,
        { eventId: ev.id, number: 'b12', x: 0, y: 900, width: 300, height: 300 },
        a.ctx(),
        ports,
      ),
      'conflict',
      'taken',
    );
    const withB13 = await executeCommand(
      saveBoothCommand,
      { eventId: ev.id, number: 'B13', x: 200, y: 0, width: 300, height: 300 },
      a.ctx(),
      ports,
    );
    expect(withB13.warnings.map((w) => w.kind)).toContain('booths_overlap');
    const b13 = withB13.booths.find((x) => x.number === 'B13');
    if (!b13) throw new Error('no booth');
    await executeCommand(
      saveBoothCommand,
      { eventId: ev.id, boothId: b13.id, number: 'B13', x: 600, y: 0, width: 300, height: 300 },
      a.ctx(),
      ports,
    );
    // The first exhibitor is primary; the second is a co-exhibitor.
    await executeCommand(
      assignBoothCommand,
      { eventId: ev.id, boothId: b12.id, exhibitorId: acme.id },
      a.ctx(),
      ports,
    );
    let p = await executeCommand(
      assignBoothCommand,
      { eventId: ev.id, boothId: b12.id, exhibitorId: globex.id },
      a.ctx(),
      ports,
    );
    expect(p.booths.find((x) => x.id === b12.id)?.exhibitors).toEqual([
      { exhibitorId: acme.id, isPrimary: true },
      { exhibitorId: globex.id, isPrimary: false },
    ]);
    expect(p.warnings.map((w) => w.kind)).not.toContain('booths_overlap');
    expect(p.warnings.some((w) => w.kind === 'shared_booth' && w.boothId === b12.id)).toBe(true);
    await rejects(
      executeCommand(
        assignBoothCommand,
        { eventId: ev.id, boothId: b12.id, exhibitorId: acme.id },
        a.ctx(),
        ports,
      ),
      'conflict',
      'already_assigned',
    );
    // Making the co-exhibitor primary demotes the old primary.
    p = await executeCommand(
      assignBoothCommand,
      { eventId: ev.id, boothId: b12.id, exhibitorId: globex.id, primary: true },
      a.ctx(),
      ports,
    );
    expect(p.booths.find((x) => x.id === b12.id)?.exhibitors).toEqual([
      { exhibitorId: globex.id, isPrimary: true },
      { exhibitorId: acme.id, isPrimary: false },
    ]);
    // Several booths and a category mismatch are warnings.
    await executeCommand(
      saveExhibitorListingCommand,
      {
        eventId: ev.id,
        exhibitorId: acme.id,
        listed: true,
        categories: ['Food'],
        links: [],
        staffAllowance: null,
      },
      a.ctx(),
      ports,
    );
    p = await executeCommand(
      assignBoothCommand,
      { eventId: ev.id, boothId: b13.id, exhibitorId: acme.id },
      a.ctx(),
      ports,
    );
    const kinds = p.warnings.map((w) => `${w.kind}:${w.exhibitorId ?? w.boothId}`);
    expect(kinds).toContain(`several_booths:${acme.id}`);
    expect(kinds).toContain(`category_mismatch:${acme.id}`);
    // Removing the primary hands primary to the co-exhibitor that is left.
    p = await executeCommand(
      unassignBoothCommand,
      { eventId: ev.id, boothId: b12.id, exhibitorId: globex.id },
      a.ctx(),
      ports,
    );
    expect(p.booths.find((x) => x.id === b12.id)?.exhibitors).toEqual([
      { exhibitorId: acme.id, isPrimary: true },
    ]);
    // Another event's exhibitor can't be placed here.
    await rejects(
      executeCommand(
        assignBoothCommand,
        { eventId: ev.id, boothId: b12.id, exhibitorId: b.event.id },
        a.ctx(),
        ports,
      ),
      'validation_failed',
    );
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['program.booth.assigned'], 3_600_000),
    );
    expect(events.filter((e) => (e.payload as { boothId?: string }).boothId === b12.id).length).toBe(3);
    // The staff view shows its booth.
    const admin = await signedIn(a, ev.id, acme.id, 'booth-view@acme.example');
    const view = await executeQuery(exhibitorPortalQuery, {}, admin.ctx, ports);
    expect(view.booths.map((x) => x.number).sort()).toEqual(['B12', 'B13']);
    // Deleting a booth takes its assignments along.
    await executeCommand(deleteBoothCommand, { eventId: ev.id, boothId: b13.id }, a.ctx(), ports);
    const after = await executeQuery(boothPlanQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.booths.map((x) => x.number)).toEqual(['B12']);
    // Bravo can't see Alpha's booths.
    await rejects(executeQuery(boothPlanQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
  });

  it('the public map carries only allowlisted fields and listed exhibitors (leak check)', async () => {
    await executeCommand(
      saveExhibitorListingCommand,
      {
        eventId: ev.id,
        exhibitorId: globex.id,
        listed: false,
        categories: [],
        links: [],
        staffAllowance: null,
      },
      a.ctx(),
      ports,
    );
    const plan = await executeQuery(boothPlanQuery, { eventId: ev.id }, a.ctx(), ports);
    const b12 = plan.booths.find((x) => x.number === 'B12');
    await executeCommand(
      assignBoothCommand,
      { eventId: ev.id, boothId: b12?.id ?? '', exhibitorId: globex.id },
      a.ctx(),
      ports,
    );
    const map = await publicExhibitorMap({ orgId: a.org.id, eventId: ev.id });
    if (!map) throw new Error('no map');
    expect(PublicExhibitorMapDto.strict().safeParse(map).success).toBe(true);
    const text = JSON.stringify(map);
    for (const leak of [
      'Globex',
      'guard@',
      'lead@acme',
      'boss@',
      '@acme.example',
      'allowance',
      'email',
      'link',
      a.org.id,
    ])
      expect(text).not.toContain(leak);
    expect(map.booths.find((x) => x.number === 'B12')?.exhibitorIds).toEqual([acme.id]);
    expect(map.exhibitors.find((x) => x.id === acme.id)).toMatchObject({
      name: 'Acme Robotics',
      boothNumbers: ['B12'],
    });
    for (const x of map.exhibitors)
      expect(Object.keys(x).sort()).toEqual(['boothNumbers', 'categories', 'description', 'id', 'name']);
    // The public program leaves the unlisted exhibitor out too.
    const program = await publicProgram({ orgId: a.org.id, eventId: ev.id });
    expect(program.exhibitors.map((x) => x.name)).not.toContain('Globex');
    // An event without booths has no map.
    expect(await publicExhibitorMap({ orgId: b.org.id, eventId: b.event.id })).not.toBeNull();
    // (Bravo's fixture event has one booth; a fresh event has none.)
    const empty = await executeCommand(
      createEventCommand,
      {
        name: `Empty ${a.org.slug}`,
        profile: 'conference',
        timezone: 'UTC',
        startsAt: '2030-06-01T10:00:00Z',
        endsAt: '2030-06-01T12:00:00Z',
      },
      a.ctx(),
      ports,
    );
    expect(await publicExhibitorMap({ orgId: a.org.id, eventId: empty.id })).toBeNull();
  });

  it('portal event roles are live assignments that grant no console permission', async () => {
    const { principal } = await signedIn(a, ev.id, acme.id, 'roles@acme.example');
    const grants = await withTenant(systemCtx(a.org.id), async (tx) => {
      const rows = await tx.execute<{ user_id: string }>(
        sql`select user_id from events.event_role_assignments where id = ${principal.eventRoleAssignmentId}`,
      );
      const userId = rows[0]?.user_id ?? '';
      return eventRoleGrantsTx(tx, ev.id, userId, new Date());
    });
    expect(grants.map((g) => g.role)).toEqual(['exhibitor_admin']);
    const userId = grants[0]?.userId ?? '';
    await rejects(
      executeQuery(boothPlanQuery, { eventId: ev.id }, userCtx(userId, a.org.id), ports),
      'forbidden',
    );
  });
});

describe('the exhibitor logo from the portal', () => {
  it('an admin replaces their own logo; staff and other exhibitors are refused', async () => {
    const x = await executeCommand(
      createExhibitorCommand,
      { eventId: ev.id, name: 'Logo Co' },
      a.ctx(),
      ports,
    );
    const admin = await signedIn(a, ev.id, x.id, 'boss@logo.example');
    const first = await uploadExhibitorLogoFromPortal(
      admin.ctx,
      { alt: 'Logo Co logo', file: await testPng() },
      ports,
    );
    expect(first.asset).toMatchObject({ ownerType: 'exhibitor', ownerId: x.id, slot: 'logo' });
    const second = await uploadExhibitorLogoFromPortal(
      admin.ctx,
      { alt: 'New logo', file: await testPng() },
      ports,
    );
    expect(second.replacedAssetId).toBe(first.asset.id);
    const list = await executeQuery(
      listMediaQuery,
      { ownerType: 'exhibitor', ownerId: x.id },
      a.ctx(),
      ports,
    );
    expect(list.map((m) => m.alt)).toEqual(['New logo']);
    const staff = await signedIn(a, ev.id, x.id, 'staff@logo.example', 'exhibitor_staff');
    await rejects(
      uploadExhibitorLogoFromPortal(staff.ctx, { alt: 'nope', file: await testPng() }, ports),
      'forbidden',
    );
    // Another exhibitor's admin only ever writes their own exhibitor's logo.
    const other = await signedIn(a, ev.id, acme.id, 'logo@acme.example');
    const theirs = await uploadExhibitorLogoFromPortal(
      other.ctx,
      { alt: 'Acme', file: await testPng() },
      ports,
    );
    expect(theirs.asset.ownerId).toBe(acme.id);
    expect(
      (await executeQuery(listMediaQuery, { ownerType: 'exhibitor', ownerId: x.id }, a.ctx(), ports)).map(
        (m) => m.alt,
      ),
    ).toEqual(['New logo']);
  });
});

describe('deleting an exhibitor', () => {
  it('ends its people’s sessions and event roles', async () => {
    const x = await executeCommand(
      createExhibitorCommand,
      { eventId: ev.id, name: 'Gone Co' },
      a.ctx(),
      ports,
    );
    const admin = await signedIn(a, ev.id, x.id, 'boss@gone.example');
    const userId = await withTenant(systemCtx(a.org.id), async (tx) => {
      const rows = await tx.execute<{ user_id: string }>(
        sql`select user_id from events.event_role_assignments where id = ${admin.principal.eventRoleAssignmentId}`,
      );
      return rows[0]?.user_id ?? '';
    });
    await executeCommand(deleteExhibitorCommand, { eventId: ev.id, exhibitorId: x.id }, a.ctx(), ports);
    expect(await portalPrincipalBySession(admin.token, HOST)).toBeNull();
    const grants = await withTenant(systemCtx(a.org.id), (tx) =>
      eventRoleGrantsTx(tx, ev.id, userId, new Date()),
    );
    expect(grants).toEqual([]);
  });
});
