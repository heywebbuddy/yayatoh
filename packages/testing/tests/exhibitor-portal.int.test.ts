import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto, eventRoleGrantsTx } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { listMediaQuery, uploadExhibitorLogoFromPortal } from '@yayatoh/media';
import { testPng } from '@yayatoh/media/testing';
import { appTokenSecret, recentEventsTx } from '@yayatoh/platform';
import {
  assignBoothCommand,
  boothPlanQuery,
  createExhibitorCommand,
  decideProfileChangeCommand,
  deleteBoothCommand,
  deleteExhibitorCommand,
  type ExhibitorDto,
  endPortalSession,
  exhibitorPortalAdminQuery,
  exhibitorPortalQuery,
  inviteExhibitorMemberCommand,
  newPortalSecret,
  openExhibitorLinkCommand,
  type PortalPrincipal,
  PublicExhibitorMapDto,
  portalInviteStaffCommand,
  portalPrincipalBySession,
  portalRevokeStaffCommand,
  portalSaveProfileCommand,
  portalSecretHash,
  publicExhibitorMap,
  publicProgram,
  requestExhibitorLinkCommand,
  resendExhibitorInviteCommand,
  revokeExhibitorMemberCommand,
  saveBoothCommand,
  saveExhibitorListingCommand,
  saveExhibitorSettingsCommand,
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

const hash = (purpose: 'link' | 'session', secret: string) =>
  portalSecretHash(appTokenSecret(), purpose, secret);
const portal = (orgId: string, now?: Date): Ctx => createCtx({ orgId, ...(now ? { now } : {}) });

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

/** Invite someone (organizer) and open their link; returns the principal and session token hash. */
async function signedIn(
  f: OrgFixture,
  eventId: string,
  exhibitorId: string,
  email: string,
  role: 'exhibitor_admin' | 'exhibitor_staff' = 'exhibitor_admin',
) {
  const link = newPortalSecret();
  const invited = await executeCommand(
    inviteExhibitorMemberCommand,
    { eventId, exhibitorId, email, role, linkHash: hash('link', link) },
    f.ctx(),
    ports,
  );
  const session = newPortalSecret();
  const principal = await executeCommand(
    openExhibitorLinkCommand,
    { memberId: invited.member.id, linkHash: hash('link', link), sessionHash: hash('session', session) },
    portal(f.org.id),
    ports,
  );
  return { principal, memberId: invited.member.id, link, sessionHash: hash('session', session) };
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

describe('exhibitor portal sign-in (M5.4a, P5-7)', () => {
  it('an invitation link signs in once, binds one event role, and revoking ends everything', async () => {
    const { principal, memberId, link, sessionHash } = await signedIn(a, ev.id, acme.id, 'lead@acme.example');
    expect(principal).toMatchObject({
      orgId: a.org.id,
      eventId: ev.id,
      role: 'exhibitor_admin',
      subjectId: acme.id,
    });
    expect(await portalPrincipalBySession(a.org.id, sessionHash)).toEqual(principal);
    // The link is spent: opening it again is refused.
    await rejects(
      executeCommand(
        openExhibitorLinkCommand,
        { memberId, linkHash: hash('link', link), sessionHash: hash('session', newPortalSecret()) },
        portal(a.org.id),
        ports,
      ),
      'invalid_state',
      'link_invalid',
    );
    // The event role is live and gives no console permission (not an org member).
    const view = await executeQuery(exhibitorPortalQuery, { principal }, portal(a.org.id), ports);
    expect(view.exhibitor.name).toBe('Acme Robotics');
    expect(view.staff?.members.map((m) => m.email)).toEqual(['lead@acme.example']);
    // A session looked up under another org finds nothing.
    expect(await portalPrincipalBySession(b.org.id, sessionHash)).toBeNull();

    await executeCommand(revokeExhibitorMemberCommand, { eventId: ev.id, memberId }, a.ctx(), ports);
    expect(await portalPrincipalBySession(a.org.id, sessionHash)).toBeNull();
    await rejects(executeQuery(exhibitorPortalQuery, { principal }, portal(a.org.id), ports), 'forbidden');
  });

  it('a wrong secret, an expired link and a forged org are refused alike', async () => {
    const link = newPortalSecret();
    const invited = await executeCommand(
      inviteExhibitorMemberCommand,
      {
        eventId: ev.id,
        exhibitorId: globex.id,
        email: 'ops@globex.example',
        role: 'exhibitor_admin',
        linkHash: hash('link', link),
      },
      a.ctx(),
      ports,
    );
    const open = (secret: string, ctx: Ctx) =>
      executeCommand(
        openExhibitorLinkCommand,
        {
          memberId: invited.member.id,
          linkHash: hash('link', secret),
          sessionHash: hash('session', newPortalSecret()),
        },
        ctx,
        ports,
      );
    await rejects(open(newPortalSecret(), portal(a.org.id)), 'invalid_state', 'link_invalid');
    await rejects(open(link, portal(b.org.id)), 'invalid_state', 'link_invalid');
    // After the event's end + 90 days the invitation is dead.
    await rejects(
      open(link, portal(a.org.id, new Date('2030-08-01T00:00:00Z'))),
      'invalid_state',
      'link_invalid',
    );
    // Asking for a sign-in link replaces the invitation's (only the newest works).
    const fresh = newPortalSecret();
    const asked = await executeCommand(
      requestExhibitorLinkCommand,
      { eventId: ev.id, email: 'OPS@globex.example', linkHash: hash('link', fresh) },
      portal(a.org.id),
      ports,
    );
    expect(asked.memberId).toBe(invited.member.id);
    await rejects(open(link, portal(a.org.id)), 'invalid_state', 'link_invalid');
    const p = await open(fresh, portal(a.org.id));
    expect(p.subjectId).toBe(globex.id);
    // An unknown address gets the same answer shape and no link.
    const none = await executeCommand(
      requestExhibitorLinkCommand,
      { eventId: ev.id, email: 'nobody@example.com', linkHash: hash('link', newPortalSecret()) },
      portal(a.org.id),
      ports,
    );
    expect(none.memberId).toBeNull();
  });

  it('signing out ends only that browser', async () => {
    const { principal, sessionHash } = await signedIn(a, ev.id, globex.id, 'second@globex.example');
    await endPortalSession(a.org.id, sessionHash);
    expect(await portalPrincipalBySession(a.org.id, sessionHash)).toBeNull();
    // The principal itself is still valid (another browser may still be signed in).
    await expect(
      executeQuery(exhibitorPortalQuery, { principal }, portal(a.org.id), ports),
    ).resolves.toBeTruthy();
  });
});

describe('an exhibitor admin cannot see or touch another exhibitor (M5.4a acceptance)', () => {
  it('guessed ids, swapped subjects and other orgs are all refused', async () => {
    const { principal } = await signedIn(a, ev.id, acme.id, 'guard@acme.example');
    const theirs = await signedIn(a, ev.id, globex.id, 'guard@globex.example');
    // Swapping the subject to another exhibitor (a guessed id) is refused.
    await rejects(
      executeQuery(
        exhibitorPortalQuery,
        { principal: { ...principal, subjectId: globex.id } },
        portal(a.org.id),
        ports,
      ),
      'forbidden',
    );
    // Another exhibitor's staff member can't be revoked (looks unknown).
    await rejects(
      executeCommand(
        portalRevokeStaffCommand,
        { principal, memberId: theirs.memberId },
        portal(a.org.id),
        ports,
      ),
      'not_found',
    );
    // The same principal in another org's context is refused.
    await rejects(executeQuery(exhibitorPortalQuery, { principal }, portal(b.org.id), ports), 'forbidden');
    // A made-up assignment id is refused.
    await rejects(
      executeQuery(
        exhibitorPortalQuery,
        { principal: { ...principal, eventRoleAssignmentId: theirs.principal.eventRoleAssignmentId } },
        portal(a.org.id),
        ports,
      ),
      'forbidden',
    );
    // What they do see is only their own exhibitor.
    const view = await executeQuery(exhibitorPortalQuery, { principal }, portal(a.org.id), ports);
    expect(JSON.stringify(view)).not.toContain('Globex');
    expect(JSON.stringify(view)).not.toContain('guard@globex.example');
  });

  it('staff see their exhibitor but not the staff list, and cannot invite or edit', async () => {
    const staff = await signedIn(a, ev.id, acme.id, 'booth@acme.example', 'exhibitor_staff');
    const view = await executeQuery(
      exhibitorPortalQuery,
      { principal: staff.principal },
      portal(a.org.id),
      ports,
    );
    expect(view.role).toBe('exhibitor_staff');
    expect(view.staff).toBeNull();
    await rejects(
      executeCommand(
        portalInviteStaffCommand,
        { principal: staff.principal, email: 'x@acme.example', linkHash: hash('link', newPortalSecret()) },
        portal(a.org.id),
        ports,
      ),
      'forbidden',
    );
    await rejects(
      executeCommand(
        portalSaveProfileCommand,
        { principal: staff.principal, name: 'Hacked' },
        portal(a.org.id),
        ports,
      ),
      'forbidden',
    );
    // A staff principal claiming the admin role is refused (no such live admin assignment).
    await rejects(
      executeQuery(
        exhibitorPortalQuery,
        { principal: { ...staff.principal, role: 'exhibitor_admin' } as PortalPrincipal },
        portal(a.org.id),
        ports,
      ),
      'forbidden',
    );
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
          linkHash: hash('link', newPortalSecret()),
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
          linkHash: hash('link', newPortalSecret()),
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
    const invite = (email: string) =>
      executeCommand(
        portalInviteStaffCommand,
        { principal: admin.principal, email, linkHash: hash('link', newPortalSecret()) },
        portal(a.org.id),
        ports,
      );
    const first = await invite('one@initech.example');
    await invite('two@initech.example');
    await rejects(invite('three@initech.example'), 'invalid_state', 'allowance_reached');
    // The same address twice is a conflict, not a second place.
    await rejects(invite('ONE@initech.example'), 'conflict', 'already_invited');
    await executeCommand(
      portalRevokeStaffCommand,
      { principal: admin.principal, memberId: first.member.id },
      portal(a.org.id),
      ports,
    );
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
    const view = await executeQuery(
      exhibitorPortalQuery,
      { principal: admin.principal },
      portal(a.org.id),
      ports,
    );
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
        executeCommand(
          portalInviteStaffCommand,
          {
            principal: admin.principal,
            email: `s${i}@umbrella.example`,
            linkHash: hash('link', newPortalSecret()),
          },
          portal(a.org.id),
          ports,
        ),
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
        principal: admin.principal,
        name: 'Hooli XYZ',
        description: 'We *compress*.',
        websiteUrl: 'https://hooli.example',
        links: [{ label: 'Jobs', url: 'https://hooli.example/jobs' }],
        categories: ['Software', 'software', 'AI'],
      },
      portal(a.org.id),
      ports,
    );
    expect(direct.status).toBe('applied');
    let view = await executeQuery(
      exhibitorPortalQuery,
      { principal: admin.principal },
      portal(a.org.id),
      ports,
    );
    expect(view.exhibitor).toMatchObject({ name: 'Hooli XYZ', categories: ['software', 'AI'] });
    expect(view.exhibitor.description).toBe('We *compress*.');
    await rejects(
      executeCommand(
        portalSaveProfileCommand,
        { principal: admin.principal, name: 'Hooli', links: [{ label: 'x', url: 'javascript:alert(1)' }] },
        portal(a.org.id),
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
      { principal: admin.principal, name: 'Hooli Pending', description: 'New copy' },
      portal(a.org.id),
      ports,
    );
    expect(waiting.status).toBe('pending');
    view = await executeQuery(exhibitorPortalQuery, { principal: admin.principal }, portal(a.org.id), ports);
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
    view = await executeQuery(exhibitorPortalQuery, { principal: admin.principal }, portal(a.org.id), ports);
    expect(view.exhibitor.name).toBe('Hooli Pending');
    expect(view.pendingChange).toBeNull();

    await executeCommand(
      portalSaveProfileCommand,
      { principal: admin.principal, name: 'Hooli Rejected' },
      portal(a.org.id),
      ports,
    );
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
    view = await executeQuery(exhibitorPortalQuery, { principal: admin.principal }, portal(a.org.id), ports);
    expect(view.exhibitor.name).toBe('Hooli Pending');
    await executeCommand(
      saveExhibitorSettingsCommand,
      { eventId: ev.id, defaultStaffAllowance: 2, approvalRequired: false },
      a.ctx(),
      ports,
    );
  });

  it('resending an invitation replaces the link; a revoked member cannot be resent', async () => {
    const link = newPortalSecret();
    const invited = await executeCommand(
      inviteExhibitorMemberCommand,
      {
        eventId: ev.id,
        exhibitorId: acme.id,
        email: 'late@acme.example',
        role: 'exhibitor_admin',
        linkHash: hash('link', link),
      },
      a.ctx(),
      ports,
    );
    const next = newPortalSecret();
    await executeCommand(
      resendExhibitorInviteCommand,
      { eventId: ev.id, memberId: invited.member.id, linkHash: hash('link', next) },
      a.ctx(),
      ports,
    );
    await rejects(
      executeCommand(
        openExhibitorLinkCommand,
        {
          memberId: invited.member.id,
          linkHash: hash('link', link),
          sessionHash: hash('session', newPortalSecret()),
        },
        portal(a.org.id),
        ports,
      ),
      'invalid_state',
    );
    await executeCommand(
      revokeExhibitorMemberCommand,
      { eventId: ev.id, memberId: invited.member.id },
      a.ctx(),
      ports,
    );
    await rejects(
      executeCommand(
        resendExhibitorInviteCommand,
        { eventId: ev.id, memberId: invited.member.id, linkHash: hash('link', newPortalSecret()) },
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
    const view = await executeQuery(
      exhibitorPortalQuery,
      { principal: admin.principal },
      portal(a.org.id),
      ports,
    );
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
      portal(a.org.id),
      { principal: admin.principal, alt: 'Logo Co logo', file: await testPng() },
      ports,
    );
    expect(first.asset).toMatchObject({ ownerType: 'exhibitor', ownerId: x.id, slot: 'logo' });
    const second = await uploadExhibitorLogoFromPortal(
      portal(a.org.id),
      { principal: admin.principal, alt: 'New logo', file: await testPng() },
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
      uploadExhibitorLogoFromPortal(
        portal(a.org.id),
        { principal: staff.principal, alt: 'nope', file: await testPng() },
        ports,
      ),
      'forbidden',
    );
    await rejects(
      uploadExhibitorLogoFromPortal(
        portal(a.org.id),
        { principal: { ...admin.principal, subjectId: acme.id }, alt: 'nope', file: await testPng() },
        ports,
      ),
      'forbidden',
    );
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
    expect(await portalPrincipalBySession(a.org.id, admin.sessionHash)).toBeNull();
    const grants = await withTenant(systemCtx(a.org.id), (tx) =>
      eventRoleGrantsTx(tx, ev.id, userId, new Date()),
    );
    expect(grants).toEqual([]);
  });
});
