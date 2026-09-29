import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  changeTeamRoleCommand,
  createEventCommand,
  eventTeamQuery,
  getEventQuery,
  grantTeamRoleTx,
  invitationEvent,
  inviteTeamMemberCommand,
  listEventsQuery,
  myTeamEventsQuery,
  removeTeamMemberCommand,
  revokeTeamInvitationCommand,
  teamEventBySlugQuery,
  updateEventCommand,
} from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import { type Ctx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { continuePayoutOnboardingCommand } from '@yayatoh/payments';
import { consumeEvent, memoryNotifier, type PublishedEvent } from '@yayatoh/platform';
import { eventSeatingQuery, setEventLayoutCommand } from '@yayatoh/seating';
import {
  acceptInvitation,
  addMemberCommand,
  invitationMailer,
  listMembersQuery,
  lookupInvitation,
  memberRole,
  signInvitation,
  updateOrganizationCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.2a (P4-8): co-hosts and planners are invited to one event, accept through the org
 * invitation token rules, and reach that event only: never another event, org settings, payouts
 * or refunds. Revocation takes effect on the next request.
 */

let a: OrgFixture;
let b: OrgFixture;
let wedding: { id: string; slug: string };
let other: { id: string; slug: string };
let bEvent: string;
const secret = () => process.env.APP_TOKEN_SECRET as string;
const stamp = () => uuidv7().slice(-10);

const floorplan = quickLayout({ rows: 0, seatsPerRow: 0, tables: 2, seatsPerTable: 8, stage: false });

async function newEvent(f: OrgFixture, name: string, profile: 'wedding' | 'gala' | 'other') {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile,
      visibility: profile === 'wedding' ? 'private' : 'public',
      timezone: 'America/Chicago',
      startsAt: '2027-10-02T20:00:00Z',
      endsAt: '2027-10-03T02:00:00Z',
    },
    f.ctx(),
    ports,
  );
  return { id: e.id, slug: e.slug };
}

/** Invite someone to the wedding as `role` and accept as a new, verified user. */
async function join(role: 'co_host' | 'planner', ctx: Ctx = a.ctx(), eventId = wedding.id) {
  const email = `team-${stamp()}@example.test`;
  const inv = await executeCommand(inviteTeamMemberCommand, { eventId, email, role }, ctx, ports);
  const userId = uuidv7();
  await acceptInvitation(
    userCtx(userId),
    signInvitation(inv.id, secret()),
    { email, emailVerified: true },
    ports,
    { grantEventRole: grantTeamRoleTx },
  );
  return { userId, email, invitationId: inv.id, ctx: (orgId = a.org.id) => userCtx(userId, orgId) };
}

const audits = async (action: string, target: string) => {
  const rows = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from platform.audit_events where action = ${action} and target_id = ${target}`,
    ),
  );
  return rows[0]?.n ?? 0;
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  wedding = await newEvent(a, 'Amina & Tomas', 'wedding');
  other = await newEvent(a, 'Spring Gala', 'gala');
  bEvent = (await newEvent(b, 'Bravo wedding', 'wedding')).id;
});
afterAll(closePools);

describe('event team invitations', () => {
  it('invites by email with the org token rules, names the event, and emails the event invitation', async () => {
    const email = `Planner-${stamp()}@Example.test`;
    const inv = await executeCommand(
      inviteTeamMemberCommand,
      { eventId: wedding.id, email, role: 'planner' },
      a.ctx(),
      ports,
    );
    expect(inv).toMatchObject({ email: email.toLowerCase(), role: 'planner' });
    const team = await executeQuery(eventTeamQuery, { eventId: wedding.id }, a.ctx(), ports);
    expect(team.invitations.map((i) => i.email)).toContain(email.toLowerCase());
    // The accept page: the org, and the event it is for.
    const token = signInvitation(inv.id, secret());
    expect(await lookupInvitation(token)).toMatchObject({
      orgId: a.org.id,
      status: 'pending',
      role: 'collaborator',
    });
    expect(await invitationEvent(inv.id)).toEqual({ eventName: 'Amina & Tomas', eventRole: 'planner' });
    // The mailer sends the event invitation, naming the event and the event role.
    const { notifier, sent } = memoryNotifier();
    const sub = invitationMailer({ notifier, appOrigin: 'https://app.yayatoh.test', secret: secret() });
    const event: PublishedEvent = {
      id: uuidv7(),
      orgId: a.org.id,
      type: 'invitation.created',
      version: 1,
      aggregateType: 'invitation',
      aggregateId: inv.id,
      payload: {
        orgId: a.org.id,
        invitationId: inv.id,
        email: inv.email,
        role: 'collaborator',
        eventRole: 'planner',
        eventName: 'Amina & Tomas',
      },
      logSeq: 1,
    };
    expect(await consumeEvent(sub, event)).toBe(true);
    expect(sent[0]).toMatchObject({
      kind: 'tenancy.event-invitation',
      params: { role: 'planner', eventName: 'Amina & Tomas' },
    });
    expect(await audits('event.team.invite', wedding.id)).toBeGreaterThan(0);
  });

  it('refuses a second pending invitation for the same address, an unknown event and another org', async () => {
    const email = `dup-${stamp()}@example.test`;
    await executeCommand(
      inviteTeamMemberCommand,
      { eventId: wedding.id, email, role: 'planner' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(inviteTeamMemberCommand, { eventId: other.id, email, role: 'co_host' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'pending_invitation' } });
    await expect(
      executeCommand(
        inviteTeamMemberCommand,
        { eventId: uuidv7(), email: `x-${stamp()}@example.test`, role: 'planner' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Org B's owner can't invite anyone to org A's event (RLS: it doesn't exist for them).
    await expect(
      executeCommand(
        inviteTeamMemberCommand,
        { eventId: wedding.id, email: `y-${stamp()}@example.test`, role: 'planner' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Only co-host and planner can be given this way; a viewer can't invite.
    await expect(
      executeCommand(
        inviteTeamMemberCommand,
        { eventId: wedding.id, email: `z-${stamp()}@example.test`, role: 'owner' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        inviteTeamMemberCommand,
        { eventId: wedding.id, email: `v-${stamp()}@example.test`, role: 'planner' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a withdrawn invitation can no longer be accepted', async () => {
    const email = `withdrawn-${stamp()}@example.test`;
    const inv = await executeCommand(
      inviteTeamMemberCommand,
      { eventId: wedding.id, email, role: 'co_host' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      revokeTeamInvitationCommand,
      { eventId: wedding.id, invitationId: inv.id },
      a.ctx(),
      ports,
    );
    await expect(
      acceptInvitation(
        userCtx(uuidv7()),
        signInvitation(inv.id, secret()),
        { email, emailVerified: true },
        ports,
        {
          grantEventRole: grantTeamRoleTx,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    // Withdrawing it again, or from another event, finds nothing.
    await expect(
      executeCommand(
        revokeTeamInvitationCommand,
        { eventId: other.id, invitationId: inv.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await audits('event.team.revokeInvitation', wedding.id)).toBeGreaterThan(0);
  });

  it('accepting makes a newcomer a collaborator of the org and gives the event role', async () => {
    const p = await join('planner');
    expect(await memberRole(p.ctx())).toBe('collaborator');
    const team = await executeQuery(eventTeamQuery, { eventId: wedding.id }, a.ctx(), ports);
    expect(team.members).toContainEqual(expect.objectContaining({ userId: p.userId, role: 'planner' }));
    expect(team.invitations.map((i) => i.id)).not.toContain(p.invitationId);
  });

  it('an existing member keeps their org role and gains the event role', async () => {
    const email = `viewer-${stamp()}@example.test`;
    const userId = uuidv7();
    await executeCommand(addMemberCommand, { userId, role: 'viewer' }, a.ctx(), ports);
    const inv = await executeCommand(
      inviteTeamMemberCommand,
      { eventId: wedding.id, email, role: 'co_host' },
      a.ctx(),
      ports,
    );
    await acceptInvitation(
      userCtx(userId),
      signInvitation(inv.id, secret()),
      { email, emailVerified: true },
      ports,
      {
        grantEventRole: grantTeamRoleTx,
      },
    );
    const ctx = userCtx(userId, a.org.id);
    expect(await memberRole(ctx)).toBe('viewer');
    // Viewer org-wide (read), co-host on the wedding (write).
    await executeCommand(updateEventCommand, { eventId: wedding.id, tagline: 'See you there' }, ctx, ports);
    await expect(
      executeCommand(updateEventCommand, { eventId: other.id, tagline: 'Nope' }, ctx, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('what a planner can reach', () => {
  let p: Awaited<ReturnType<typeof join>>;
  beforeAll(async () => {
    p = await join('planner');
  });

  it('works on the event: reads it, seats guests (floor plan), lists just this event', async () => {
    expect((await executeQuery(getEventQuery, { eventId: wedding.id }, p.ctx(), ports)).id).toBe(wedding.id);
    await executeCommand(setEventLayoutCommand, { eventId: wedding.id, doc: floorplan }, p.ctx(), ports);
    expect(await executeQuery(eventSeatingQuery, { eventId: wedding.id }, p.ctx(), ports)).not.toBeNull();
    const mine = await executeQuery(myTeamEventsQuery, {}, p.ctx(), ports);
    expect(mine.map((e) => e.id)).toEqual([wedding.id]);
    expect(mine[0]?.roles).toEqual(['planner']);
    expect((await executeQuery(teamEventBySlugQuery, { slug: wedding.slug }, p.ctx(), ports)).id).toBe(
      wedding.id,
    );
  });

  it('never reaches another event, the org-wide event list or the event settings', async () => {
    await expect(executeQuery(getEventQuery, { eventId: other.id }, p.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(setEventLayoutCommand, { eventId: other.id, doc: floorplan }, p.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(teamEventBySlugQuery, { slug: other.slug }, p.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(executeQuery(listEventsQuery, {}, p.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // No events:write: the event's details are the co-host's and the organizer's.
    await expect(
      executeCommand(updateEventCommand, { eventId: wedding.id, tagline: 'x' }, p.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // No team management.
    await expect(executeQuery(eventTeamQuery, { eventId: wedding.id }, p.ctx(), ports)).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
  });

  it('is refused org settings, members, payouts and refunds', async () => {
    await expect(
      executeCommand(updateOrganizationCommand, { name: 'Taken over' }, p.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(listMembersQuery, {}, p.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeCommand(continuePayoutOnboardingCommand, {}, p.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const { startRefundCommand } = await import('@yayatoh/orders');
    await expect(
      executeCommand(
        startRefundCommand,
        { orderId: uuidv7(), reason: 'requested_by_customer', amountMinor: 100 },
        p.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('has nothing in another org', async () => {
    await expect(
      executeQuery(getEventQuery, { eventId: bEvent }, p.ctx(b.org.id), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await executeQuery(myTeamEventsQuery, {}, a.ctx(), ports)).toEqual([]);
    await expect(executeQuery(myTeamEventsQuery, {}, p.ctx(b.org.id), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('what a co-host can reach', () => {
  let c: Awaited<ReturnType<typeof join>>;
  beforeAll(async () => {
    c = await join('co_host');
  });

  it('runs the whole event, including its team', async () => {
    await executeCommand(updateEventCommand, { eventId: wedding.id, tagline: 'Forever' }, c.ctx(), ports);
    const planner = await join('planner', c.ctx());
    const team = await executeQuery(eventTeamQuery, { eventId: wedding.id }, c.ctx(), ports);
    expect(team.members.map((m) => m.userId)).toContain(planner.userId);
  });

  it('is refused other events, org settings, members and payouts', async () => {
    await expect(
      executeCommand(updateEventCommand, { eventId: other.id, tagline: 'x' }, c.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        inviteTeamMemberCommand,
        { eventId: other.id, email: `c-${stamp()}@example.test`, role: 'planner' },
        c.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(updateOrganizationCommand, { name: 'x' }, c.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeQuery(listMembersQuery, {}, c.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeCommand(continuePayoutOnboardingCommand, {}, c.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('changing and revoking', () => {
  it('changes a planner to co-host (audited), one team role per event', async () => {
    const p = await join('planner');
    await expect(
      executeCommand(updateEventCommand, { eventId: wedding.id, tagline: 'x' }, p.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(
      changeTeamRoleCommand,
      { eventId: wedding.id, userId: p.userId, role: 'co_host' },
      a.ctx(),
      ports,
    );
    await executeCommand(updateEventCommand, { eventId: wedding.id, tagline: 'Promoted' }, p.ctx(), ports);
    const mine = await executeQuery(myTeamEventsQuery, {}, p.ctx(), ports);
    expect(mine[0]?.roles).toEqual(['co_host']);
    expect(await audits('event.team.changeRole', wedding.id)).toBeGreaterThan(0);
    // Someone not on the team can't be "changed".
    await expect(
      executeCommand(
        changeTeamRoleCommand,
        { eventId: wedding.id, userId: uuidv7(), role: 'planner' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('revoking takes effect immediately; a collaborator with no event left leaves the org', async () => {
    const p = await join('planner');
    expect((await executeQuery(getEventQuery, { eventId: wedding.id }, p.ctx(), ports)).id).toBe(wedding.id);
    const out = await executeCommand(
      removeTeamMemberCommand,
      { eventId: wedding.id, userId: p.userId },
      a.ctx(),
      ports,
    );
    expect(out.leftOrg).toBe(true);
    await expect(executeQuery(getEventQuery, { eventId: wedding.id }, p.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await memberRole(p.ctx())).toBeNull();
    expect(await audits('event.team.remove', wedding.id)).toBeGreaterThan(0);
  });

  it('a collaborator on two events keeps the org when one is revoked', async () => {
    const p = await join('planner');
    const inv = await executeCommand(
      inviteTeamMemberCommand,
      { eventId: other.id, email: `second-${stamp()}@example.test`, role: 'planner' },
      a.ctx(),
      ports,
    );
    // The same person accepts a second event's invitation (their verified address is the invitee's).
    await acceptInvitation(
      userCtx(p.userId),
      signInvitation(inv.id, secret()),
      { email: inv.email, emailVerified: true },
      ports,
      { grantEventRole: grantTeamRoleTx },
    );
    const out = await executeCommand(
      removeTeamMemberCommand,
      { eventId: wedding.id, userId: p.userId },
      a.ctx(),
      ports,
    );
    expect(out.leftOrg).toBe(false);
    expect(await memberRole(p.ctx())).toBe('collaborator');
    expect((await executeQuery(myTeamEventsQuery, {}, p.ctx(), ports)).map((e) => e.id)).toEqual([other.id]);
  });

  it('only owners, admins and co-hosts manage the team; changes are step-up', async () => {
    const p = await join('planner');
    await expect(
      executeCommand(
        removeTeamMemberCommand,
        { eventId: wedding.id, userId: p.userId },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(
        removeTeamMemberCommand,
        { eventId: wedding.id, userId: p.userId },
        a.ctx({ stepUpAt: null }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'step_up_required' });
  });
});
