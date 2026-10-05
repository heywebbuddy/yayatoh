import { randomBytes } from 'node:crypto';
import { stageImportCommand, validateImportCommand } from '@yayatoh/attendees';
import { consoleMailer, createAuth, findUserByEmail, findUserById } from '@yayatoh/auth';
import { recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withoutTenant, withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { startCheckoutCommand } from '@yayatoh/orders';
import {
  addressHash,
  auditEntriesTx,
  erasedAddress,
  liftErasedAccountMail,
  verifyAuditChainTx,
} from '@yayatoh/platform';
import {
  accountDeletionBlockers,
  deleteAccount,
  detachAccountCommand,
  exportAccount,
  findSubjectQuery,
} from '@yayatoh/privacy';
import {
  addMemberCommand,
  createOrganization,
  inviteMemberCommand,
  listInvitationsQuery,
  listMembersQuery,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseNow, exportNow } from '../src/dsar/helpers.ts';
import { type OrgFixture, systemCtx, twoOrgs, userCtx } from '../src/index.ts';
import { ports } from '../src/ports.ts';

/**
 * M1.14e: data-subject requests about Yayatoh's own accounts (self-service and staff), team
 * invitations in the org-side DSAR, and the platform-wide erased-address suppression.
 */
const ORIGIN = 'https://app.yayatoh.test';
const PASSWORD = 'correct horse battery staple';
const auth = createAuth({
  baseURL: 'http://localhost:3998',
  secret: randomBytes(32).toString('hex'),
  mailer: consoleMailer,
  // As the web does: signing up again lifts the account-mail suppression (M1.14e).
  onUserCreated: async (u) => {
    await liftErasedAccountMail(u.email);
  },
});
const notifier = createNotifier();
const admin = adminClient();
const tag = () => randomBytes(3).toString('hex');

let a: OrgFixture;
let b: OrgFixture;
let freeB: { id: string; eventId: string };

async function signUp(label: string) {
  const email = `${label}-${tag()}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: `${label} Person` } });
  return { id: r.user.id, email, token: r.token as string };
}

const fresh = () => new Date();
const self = { type: 'self' } as const;

async function buyInB(email: string, userId: string | null) {
  return executeCommand(
    startCheckoutCommand,
    {
      eventId: freeB.eventId,
      items: [{ ticketTypeId: freeB.id, quantity: 1 }],
      buyer: { email, name: 'Rae Buyer' },
      marketingOptIn: true,
    },
    userId ? userCtx(userId, b.org.id) : createCtx({ orgId: b.org.id }),
    ports,
  );
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const e = await executeCommand(
    createEventCommand,
    {
      name: 'Bravo Garden Party',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T23:00:00Z',
      endsAt: '2030-06-02T03:00:00Z',
    },
    b.ctx(),
    ports,
  );
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'Free', priceMinor: 0, quantityTotal: 500 },
    b.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, b.ctx(), ports);
  freeB = { id: tt.id, eventId: e.id };
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('account export (self-service)', () => {
  it('needs a recent step-up and returns an allowlisted document across orgs', async () => {
    const u = await signUp('exporter');
    await executeCommand(addMemberCommand, { userId: u.id, role: 'manager' }, a.ctx(), ports);
    await buyInB(u.email, u.id);
    await executeCommand(inviteMemberCommand, { email: u.email, role: 'viewer' }, b.ctx(), ports);

    const stale = new Date(Date.now() - 11 * 60_000);
    await expect(
      exportAccount({ userId: u.id, email: u.email, by: self, stepUpAt: stale }),
    ).rejects.toMatchObject({ code: 'step_up_required' });

    const { doc, fileName } = await exportAccount({
      userId: u.id,
      email: u.email,
      by: self,
      sessionToken: u.token,
      stepUpAt: fresh(),
    });
    expect(fileName).toMatch(/^yayatoh-account-\d{4}-\d{2}-\d{2}\.json$/);
    expect(doc.format).toBe('yayatoh.account/1');
    expect(doc.account?.profile).toMatchObject({ email: u.email, name: 'exporter Person' });
    expect(doc.account?.signIn.password).toBe(true);
    expect(doc.account?.sessions.some((s) => s.current)).toBe(true);
    expect(doc.organizations).toEqual([
      expect.objectContaining({ organization: 'Alpha Events', role: 'manager' }),
    ]);
    const purchase = doc.purchases.find((p) => p.organizer === 'Bravo Weddings');
    expect(purchase?.orders).toHaveLength(1);
    expect(purchase?.orders[0]).toMatchObject({ buyerEmail: u.email, status: 'paid' });
    expect(purchase?.tickets).toHaveLength(1);
    expect(Object.values(purchase?.events ?? {})).toContain('Bravo Garden Party');
    expect(purchase?.marketingConsents[0]).toMatchObject({ status: 'granted', purpose: 'marketing' });
    expect(doc.teamInvitations).toEqual([
      expect.objectContaining({ organization: 'Bravo Weddings', role: 'viewer', status: 'pending' }),
    ]);
    // Nothing secret leaves: no session token, password hash, TOTP seed, manage token or ids of
    // other people.
    const text = JSON.stringify(doc);
    expect(text).not.toContain(u.token);
    expect(text).not.toMatch(/"token"|"password":"|\$argon2|secret|backupCodes|manageToken|invitedBy/);
    expect(text).not.toContain(a.ownerId);

    // Recorded (masked, hashed) and a security event for the account.
    const rows = await admin<{ kind: string; actor: string; subject_hint: string }[]>`
      select kind, actor, subject_hint from privacy.account_requests where subject_ref = ${addressHash(u.email)}`;
    expect(rows).toEqual([{ kind: 'access', actor: 'self', subject_hint: `e•••@example.test` }]);
    const events = await admin<{ action: string }[]>`
      select action from auth.security_events where user_id = ${u.id} and action = 'account.exported'`;
    expect(events).toHaveLength(1);
  });

  it('app_user cannot read the request record or the erased list directly', async () => {
    for (const table of ['privacy.account_requests', 'platform.erased_addresses'])
      await expect(
        withoutTenant((tx) => tx.execute(sql.raw(`select * from ${table} limit 1`))),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

describe('account deletion (self-service)', () => {
  it('is refused while the person is the only owner of an org, naming it', async () => {
    const o = await signUp('owner');
    const org = await createOrganization(
      userCtx(o.id),
      { slug: `solo-${tag()}`, name: 'Solo Studio' },
      ports,
    );
    expect((await accountDeletionBlockers(o.id)).map((x) => x.name)).toEqual(['Solo Studio']);
    await expect(
      deleteAccount({ userId: o.id, email: o.email, by: self, ports, stepUpAt: fresh() }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'last_owner', orgs: ['Solo Studio'] },
    });
    // Nothing changed.
    expect((await findUserById(o.id))?.deletedAt).toBeNull();
    expect(
      await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${o.token}` }) }),
    ).not.toBeNull();
    // With a second owner it goes through.
    const co = await signUp('coowner');
    await executeCommand(addMemberCommand, { userId: co.id, role: 'owner' }, userCtx(o.id, org.id), ports);
    expect(await accountDeletionBlockers(o.id)).toEqual([]);
  });

  it('needs a recent step-up', async () => {
    const u = await signUp('stale');
    await expect(
      deleteAccount({
        userId: u.id,
        email: u.email,
        by: self,
        ports,
        stepUpAt: new Date(Date.now() - 11 * 60_000),
      }),
    ).rejects.toMatchObject({ code: 'step_up_required' });
    await expect(deleteAccount({ userId: u.id, email: u.email, by: self, ports })).rejects.toMatchObject({
      code: 'step_up_required',
    });
    expect((await findUserById(u.id))?.deletedAt).toBeNull();
  });

  it('anonymises the account, revokes sessions, unlinks orders and keeps every audit chain valid', async () => {
    const u = await signUp('leaver');
    await executeCommand(addMemberCommand, { userId: u.id, role: 'admin' }, a.ctx(), ports);
    const bought = await buyInB(u.email, u.id);
    await executeCommand(inviteMemberCommand, { email: u.email, role: 'viewer' }, b.ctx(), ports);
    const notified: string[] = [];
    const r = await deleteAccount({
      userId: u.id,
      email: u.email,
      by: self,
      ports,
      stepUpAt: fresh(),
      notify: async (to) => {
        // The confirmation goes to the old address while the account still exists.
        expect((await findUserById(u.id))?.deletedAt).toBeNull();
        notified.push(to);
      },
    });
    expect(notified).toEqual([u.email]);
    expect(r.summary).toMatchObject({ memberships: 1, ordersUnlinked: 1, invitations: 1 });
    expect(r.summary.sessions).toBeGreaterThanOrEqual(1);

    // Identity: anonymised, no credentials, no sessions; the old email finds nothing.
    const gone = await findUserById(u.id);
    expect(gone?.deletedAt).toBeInstanceOf(Date);
    expect(gone?.name).toBe('');
    expect(gone?.email).toMatch(new RegExp(`^${addressHash(u.email)}\\+${u.id}@erased\\.invalid$`));
    expect(await findUserByEmail(u.email)).toBeNull();
    const [counts] = await admin<{ s: number; c: number; t: number }[]>`
      select (select count(*)::int from auth.sessions where user_id = ${u.id}) as s,
             (select count(*)::int from auth.accounts where user_id = ${u.id}) as c,
             (select count(*)::int from auth.two_factors where user_id = ${u.id}) as t`;
    expect(counts).toEqual({ s: 0, c: 0, t: 0 });
    expect(
      await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${u.token}` }) }),
    ).toBeNull();
    await expect(auth.api.signInEmail({ body: { email: u.email, password: PASSWORD } })).rejects.toThrow();
    // Security event kept under the pseudonymous id.
    const ev = await admin<{ action: string }[]>`
      select action from auth.security_events where user_id = ${u.id} order by created_at`;
    expect(ev.map((e) => e.action)).toContain('account.deleted');

    // Org A: membership gone; audited against the user id; chain intact.
    const members = await executeQuery(listMembersQuery, {}, a.ctx(), ports);
    expect(members.map((m) => m.userId)).not.toContain(u.id);
    // Org B: the order stays (with its buyer email: the org's record), unlinked from the account;
    // the invitation is gone.
    const [order] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ buyer_user_id: string | null; buyer_email: string }>(
        sql`select buyer_user_id, buyer_email from orders.orders where id = ${bought.order.id}`,
      ),
    );
    expect(order).toEqual({ buyer_user_id: null, buyer_email: u.email });
    const invites = await executeQuery(listInvitationsQuery, {}, b.ctx(), ports);
    expect(invites.map((i) => i.email)).not.toContain(u.email);
    for (const f of [a, b]) {
      const status = await withTenant(systemCtx(f.org.id), (tx) => verifyAuditChainTx(tx));
      expect(status).toMatchObject({ verified: true, brokenAt: null });
      const entries = await withTenant(systemCtx(f.org.id), (tx) =>
        tx.execute<{ action: string; target_id: string; data: Record<string, unknown> }>(
          sql`select action, target_id, data from platform.audit_events where action = 'privacy.account_erased' and target_id = ${u.id}`,
        ),
      );
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0]?.data)).not.toContain('@');
    }

    // Platform-wide: the address is on the erased list (hashed); the request is recorded.
    expect(await erasedAddress(u.email)).toMatchObject({ accountLiftedAt: null });
    const req = await admin<{ kind: string; actor: string }[]>`
      select kind, actor from privacy.account_requests where subject_ref = ${addressHash(u.email)}`;
    expect(req).toEqual([{ kind: 'erasure', actor: 'self' }]);
    const raw = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.erased_addresses where address_hash = ${u.email}`;
    expect(raw[0]?.n).toBe(0);

    // Signing up again works (a new account) and lifts the account-mail suppression only.
    const again = await auth.api.signUpEmail({
      body: { email: u.email, password: PASSWORD, name: 'Back Again' },
    });
    expect(again.user.id).not.toBe(u.id);
    expect((await erasedAddress(u.email))?.accountLiftedAt).toBeInstanceOf(Date);
  });

  it('only the platform may detach an account from an org (owners and members are refused)', async () => {
    await expect(
      executeCommand(detachAccountCommand, { userId: a.viewerId, email: 'x@example.test' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // A detach in org A never touches org B (tenant transaction).
    const u = await signUp('isolated');
    await executeCommand(addMemberCommand, { userId: u.id, role: 'viewer' }, b.ctx(), ports);
    await executeCommand(
      detachAccountCommand,
      { userId: u.id, email: u.email },
      createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'test' } }),
      ports,
    );
    const members = await executeQuery(listMembersQuery, {}, b.ctx(), ports);
    expect(members.map((m) => m.userId)).toContain(u.id);
  });
});

describe('staff-handled account requests', () => {
  const staff = (reason: string) => ({ type: 'staff' as const, staffUserId: uuidv7(), reason });

  it('requires a reason, exports without step-up, and erases an address that has only invitations', async () => {
    const u = await signUp('ticket');
    await expect(exportAccount({ email: u.email.toUpperCase(), by: staff('short') })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const { doc } = await exportAccount({
      email: u.email.toUpperCase(),
      by: staff('Support ticket #4411 access request'),
    });
    expect(doc.account?.profile.email).toBe(u.email);

    const invited = `invited-only-${tag()}@example.test`;
    await executeCommand(inviteMemberCommand, { email: invited, role: 'viewer' }, a.ctx(), ports);
    const r = await deleteAccount({ email: invited, by: staff('Emailed request, identity verified'), ports });
    expect(r.summary).toMatchObject({ organizations: 1, invitations: 1, memberships: 0 });
    expect(await erasedAddress(invited)).not.toBeNull();
    await expect(
      deleteAccount({
        email: `nobody-${tag()}@example.test`,
        by: staff('Emailed request, identity verified'),
        ports,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [row] = await admin<{ actor: string; reason: string }[]>`
      select actor, reason from privacy.account_requests where subject_ref = ${addressHash(invited)}`;
    expect(row?.actor).toMatch(/^staff:/);
    expect(row?.reason).toBe('Emailed request, identity verified');
  });

  it('applies the same last-owner rule', async () => {
    const o = await signUp('staffowner');
    await createOrganization(userCtx(o.id), { slug: `staffsolo-${tag()}`, name: 'Staff Solo' }, ports);
    await expect(
      deleteAccount({ email: o.email, by: staff('Deletion requested by phone'), ports }),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { orgs: ['Staff Solo'] } });
  });
});

describe('team invitations in the org-side DSAR', () => {
  it('are found, exported and removed on erasure', async () => {
    const email = `invitee-${tag()}@example.test`;
    await executeCommand(inviteMemberCommand, { email, role: 'manager' }, a.ctx(), ports);
    const found = await executeQuery(findSubjectQuery, { email }, a.ctx(), ports);
    expect(found).toMatchObject({ found: true, summary: { tenancy: 1 } });
    // Org B holds nothing about them.
    expect((await executeQuery(findSubjectQuery, { email }, b.ctx(), ports)).found).toBe(false);
    const { modules } = await exportNow(email, a.ctx());
    const doc = modules.tenancy as { invitations: { role: string; status: string }[] };
    expect(doc.invitations).toEqual([expect.objectContaining({ role: 'manager', status: 'pending' })]);
    expect(JSON.stringify(modules)).not.toContain('invitedBy');
    // The access request is closed now; erasure is a new request.
    const r = await eraseNow(email, a.ctx());
    expect(r.receipt.erased).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'tenancy.invitations', rows: 1 })]),
    );
    const invites = await executeQuery(listInvitationsQuery, {}, a.ctx(), ports);
    expect(invites.map((i) => i.email)).not.toContain(email);
    expect(await erasedAddress(email)).not.toBeNull();
  });
});

describe('platform-wide erased-address suppression', () => {
  const message = (orgId: string, kind: string, email: string, key: string, params: Record<string, string>) =>
    withTenant(systemCtx(orgId), (tx) =>
      notifier.enqueue(tx, { kind, to: { email }, params, dedupeKey: key, channels: ['email'] }),
    );
  const statusOf = async (orgId: string, key: string) => {
    const [m] = await withTenant(systemCtx(orgId), (tx) =>
      tx.execute<{ status: string; reason: string | null }>(
        sql`select status, reason from notifications.messages where dedupe_key = ${key}`,
      ),
    );
    return m;
  };
  const update = { subject: 'Parking', body: 'Lot B is open.', name: 'Rae', eventName: 'Garden Party' };

  it('an erasure in one org suppresses org mail in every org, lets order mail through, and honours a new consent', async () => {
    const email = `erased-${tag()}@example.test`;
    await buyInB(email, null);
    // Org A erases the person (they were on A's list too).
    await withTenant(a.ctx(), (tx) => upsertContactTx(tx, a.ctx(), { email, source: 'manual' }));
    await eraseNow(email, a.ctx());

    const k = tag();
    await message(b.org.id, 'attendees.message', email, `upd-${k}`, update);
    await message(b.org.id, 'ticketing.holder-link', email, `hold-${k}`, {
      url: `${ORIGIN}/my-tickets/x`,
      eventName: 'Garden Party',
    });
    await message(b.org.id, 'tenancy.invitation', email, `inv-${k}`, {
      url: `${ORIGIN}/invite/x`,
      role: 'viewer',
      orgName: 'Bravo Weddings',
    });
    const { transports, emails } = memoryTransports();
    await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    expect(await statusOf(b.org.id, `upd-${k}`)).toEqual({ status: 'suppressed', reason: 'erased' });
    expect(await statusOf(b.org.id, `inv-${k}`)).toEqual({ status: 'suppressed', reason: 'erased' });
    expect(await statusOf(b.org.id, `hold-${k}`)).toMatchObject({ status: 'sent' });
    expect(emails.filter((e) => e.to === email)).toHaveLength(1);

    // Consent given again in org B after the erasure: B's updates reach them; org A's don't.
    await withTenant(b.ctx(), async (tx) => {
      const c = await upsertContactTx(tx, b.ctx(), { email, source: 'checkout' });
      await recordConsentTx(tx, b.ctx(), {
        contactId: c.id,
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
        evidence: 'test:regiven',
      });
    });
    await message(b.org.id, 'attendees.message', email, `upd2-${k}`, update);
    await message(a.org.id, 'attendees.message', email, `upd3-${k}`, update);
    await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    expect(await statusOf(b.org.id, `upd2-${k}`)).toMatchObject({ status: 'sent' });
    expect(await statusOf(a.org.id, `upd3-${k}`)).toEqual({ status: 'suppressed', reason: 'erased' });

    // Signing up again lifts account mail (invitations) everywhere.
    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Back' } });
    await message(b.org.id, 'tenancy.invitation', email, `inv2-${k}`, {
      url: `${ORIGIN}/invite/y`,
      role: 'viewer',
      orgName: 'Bravo Weddings',
    });
    await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    expect(await statusOf(b.org.id, `inv2-${k}`)).toMatchObject({ status: 'sent' });
  });

  it('a contact import in any org skips an erased address with the reason', async () => {
    const email = `gone-${tag()}@example.test`;
    await withTenant(a.ctx(), (tx) => upsertContactTx(tx, a.ctx(), { email, source: 'manual' }));
    await eraseNow(email, a.ctx());
    const csv = `Name,Email\nGone Person,${email.toUpperCase()}\nKeep Person,keep-${tag()}@example.test\n`;
    const s = await executeCommand(
      stageImportCommand,
      { eventId: freeB.eventId, fileName: 'guests.csv', csv },
      b.ctx(),
      ports,
    );
    const v = await executeCommand(
      validateImportCommand,
      { eventId: freeB.eventId, batchId: s.batchId, mapping: { name: 0, email: 1 } },
      b.ctx(),
      ports,
    );
    expect(v).toEqual({ valid: 1, invalid: 1 });
    const [row] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ error_code: string }>(
        sql`select error_code from attendees.import_rows where batch_id = ${s.batchId} and row_no = 1`,
      ),
    );
    expect(row?.error_code).toBe('erased');
  });

  it('keeps the audit trail of the erasure itself free of the address', async () => {
    const entries = await withTenant(systemCtx(a.org.id), (tx) => auditEntriesTx(tx, {}, { limit: 50 }));
    expect(JSON.stringify(entries)).not.toMatch(/erased-[0-9a-f]{6}@example\.test/);
  });
});
