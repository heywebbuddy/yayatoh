import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, memoryNotifier, type PublishedEvent } from '@yayatoh/platform';
import {
  acceptInvitation,
  invitationMailer,
  inviteMemberCommand,
  listInvitationsQuery,
  listMembersQuery,
  lookupInvitation,
  revokeInvitationCommand,
  signInvitation,
} from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
const secret = () => process.env.APP_TOKEN_SECRET as string;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

async function invite(email: string, role: 'manager' | 'owner' | 'viewer' = 'manager', ctx = a.ctx()) {
  const inv = await executeCommand(inviteMemberCommand, { email, role }, ctx, ports);
  return { inv, token: signInvitation(inv.id, secret()) };
}

describe('invitations', () => {
  it('invites, lists as pending and emails a link whose token is derived, not stored', async () => {
    const { inv } = await invite('Lee@Example.test');
    expect(inv.email).toBe('lee@example.test');
    const pending = await executeQuery(listInvitationsQuery, {}, a.ctx(), ports);
    expect(pending.map((p) => p.email)).toContain('lee@example.test');

    const { notifier, sent } = memoryNotifier();
    const sub = invitationMailer({ notifier, appOrigin: 'https://app.yayatoh.test', secret: secret() });
    const event: PublishedEvent = {
      id: uuidv7(),
      orgId: a.org.id,
      type: 'invitation.created',
      version: 1,
      aggregateType: 'invitation',
      aggregateId: inv.id,
      payload: { orgId: a.org.id, invitationId: inv.id, email: inv.email, role: inv.role },
      logSeq: 1,
    };
    expect(await consumeEvent(sub, event)).toBe(true);
    expect(sent[0]).toMatchObject({ kind: 'tenancy.invitation', to: { email: inv.email } });
    expect(sent[0]?.params.url).toBe(
      `https://app.yayatoh.test/invite/${encodeURIComponent(signInvitation(inv.id, secret()))}`,
    );
    expect(JSON.stringify(event.payload)).not.toContain(signInvitation(inv.id, secret()).split('~')[1]);
  });

  it('accepts for the matching verified email and adds the membership with the invited role', async () => {
    const { token } = await invite('new.manager@example.test');
    const userId = uuidv7();
    const m = await acceptInvitation(
      userCtx(userId),
      token,
      { email: 'new.manager@example.test', emailVerified: true },
      ports,
    );
    expect(m).toMatchObject({ orgId: a.org.id, userId, role: 'manager' });
    const members = await executeQuery(listMembersQuery, {}, a.ctx(), ports);
    expect(members.map((x) => x.userId)).toContain(userId);
    // Single use.
    await expect(
      acceptInvitation(
        userCtx(uuidv7()),
        token,
        { email: 'new.manager@example.test', emailVerified: true },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('refuses a different or unverified email, a forged token and a revoked invitation', async () => {
    const { inv, token } = await invite('only.me@example.test');
    await expect(
      acceptInvitation(
        userCtx(uuidv7()),
        token,
        { email: 'someone.else@example.test', emailVerified: true },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      acceptInvitation(
        userCtx(uuidv7()),
        token,
        { email: 'only.me@example.test', emailVerified: false },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await lookupInvitation(`${inv.id}~forged`)).toBeNull();
    await executeCommand(revokeInvitationCommand, { invitationId: inv.id }, a.ctx(), ports);
    expect((await lookupInvitation(token))?.status).toBe('revoked');
  });

  it('only an owner may invite an owner; a viewer cannot invite at all', async () => {
    await expect(invite('boss@example.test', 'viewer', userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(invite('co-owner@example.test', 'owner')).resolves.toBeTruthy();
  });

  it('a token for org A can never join org B', async () => {
    const { token } = await invite('crossing@example.test');
    const m = await acceptInvitation(
      userCtx(uuidv7()),
      token,
      { email: 'crossing@example.test', emailVerified: true },
      ports,
    );
    expect(m.orgId).toBe(a.org.id);
    expect(m.orgId).not.toBe(b.org.id);
  });
});
