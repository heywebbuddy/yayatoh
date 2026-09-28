import {
  type AccountUser,
  accountIdentityData,
  anonymiseAccount,
  findUserByEmail,
  findUserById,
  recordAccountEvent,
} from '@yayatoh/auth';
import { contactDsarTx, normalizeEmail, unlinkContactUserTx } from '@yayatoh/crm';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx, removeUserEventRolesTx } from '@yayatoh/events';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  isStepUpFresh,
  requireOrg,
} from '@yayatoh/kernel';
import { eraseUserNotificationsTx, userPreferencesTx } from '@yayatoh/notifications';
import { buyerOrdersDsarTx, buyerOrgs, unlinkBuyerUserTx } from '@yayatoh/orders';
import { addressHash, markAddressErased, tenantCommand } from '@yayatoh/platform';
import {
  accountMembershipTx,
  agreementsAcceptedByTx,
  eraseInvitationsDsarTx,
  invitationOrgs,
  invitationsDsarTx,
  leaveOrganizationTx,
  myOrganizations,
  organizationNameTx,
  soleOwnerOrgs,
} from '@yayatoh/tenancy';
import { ticketsDsarTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { maskEmail } from './dsar.ts';

/**
 * Data-subject requests about a person's own Yayatoh account (M1.14e). Here Yayatoh is the
 * controller (the account, its sessions and security history, which orgs the person works in),
 * while each org stays the controller of its own customer records. The person downloads their
 * account data and deletes their account on the account page; staff handle the same requests
 * from the admin console (with a reason). Both are recorded in `privacy.account_requests`
 * (hashed subject, masked hint) and the erased address joins the platform-wide suppression list.
 */

export const ACCOUNT_FORMAT = 'yayatoh.account/1';

/** Who handles the request: the person themselves, or a staff member with a written reason. */
export type AccountRequestBy =
  | { readonly type: 'self' }
  | { readonly type: 'staff'; readonly staffUserId: string; readonly reason: string };

export const StaffReason = z.string().trim().min(10).max(500);

const actorOf = (by: AccountRequestBy) => (by.type === 'self' ? 'self' : `staff:${by.staffUserId}`);
const actorName = (by: AccountRequestBy) =>
  by.type === 'self' ? 'privacy.account-self' : `staff:${by.staffUserId}`;

// ─── The document (allowlisted) ─────────────────────────────────────────────────────────────

const Dateish = z.coerce.date();

const OrderOut = z.object({
  id: z.string(),
  eventId: z.string(),
  status: z.string(),
  buyerName: z.string(),
  buyerEmail: z.string(),
  currency: z.string(),
  totalMinor: z.number(),
  promoCode: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  createdAt: Dateish,
  paidAt: Dateish.nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number(), unitFaceMinor: z.number() })),
  refunds: z.array(z.object({ amountMinor: z.number(), status: z.string(), createdAt: Dateish })),
});

const TicketOut = z.object({
  eventId: z.string(),
  orderId: z.string().nullable(),
  shortCode: z.string().nullable(),
  status: z.string(),
  holderName: z.string().nullable(),
  holderEmail: z.string().nullable(),
  seatLabel: z.string().nullable(),
  createdAt: Dateish,
});

const ConsentOut = z.object({
  channel: z.string(),
  purpose: z.string(),
  status: z.string(),
  evidence: z.string(),
  capturedAt: Dateish,
});

const InvitationOut = z.object({
  role: z.string(),
  status: z.string(),
  invitedAt: Dateish,
  expiresAt: Dateish,
});

/**
 * The access document. Zod objects drop every key they don't declare, so whatever the modules
 * return, only these fields leave: no tokens, password hashes, TOTP seeds, backup codes,
 * provider ids, internal contact ids or other people's data.
 */
export const AccountDocument = z.object({
  format: z.literal(ACCOUNT_FORMAT),
  generatedAt: Dateish,
  controller: z.string(),
  subject: z.object({ email: z.string() }),
  account: z
    .object({
      profile: z.object({
        name: z.string(),
        email: z.string(),
        emailVerified: z.boolean(),
        emailLanguage: z.string().nullable(),
        createdAt: Dateish,
      }),
      signIn: z.object({
        password: z.boolean(),
        emailCodes: z.boolean(),
        twoStepVerification: z.boolean(),
        providers: z.array(z.string()),
      }),
      sessions: z.array(
        z.object({
          current: z.boolean(),
          signedInAt: Dateish,
          lastActiveAt: Dateish,
          expiresAt: Dateish,
          ipAddress: z.string().nullable(),
          device: z.string().nullable(),
        }),
      ),
      securityEvents: z.array(
        z.object({ action: z.string(), details: z.record(z.string(), z.string()), at: Dateish }),
      ),
    })
    .nullable(),
  organizations: z.array(
    z.object({
      organization: z.string(),
      role: z.string(),
      memberSince: Dateish,
      notificationPreferences: z.array(
        z.object({ category: z.string(), channel: z.string(), enabled: z.boolean() }),
      ),
      agreements: z.array(z.object({ document: z.string(), version: z.string(), acceptedAt: Dateish })),
    }),
  ),
  purchases: z.array(
    z.object({
      organizer: z.string(),
      events: z.record(z.string(), z.string()),
      orders: z.array(OrderOut),
      tickets: z.array(TicketOut),
      marketingConsents: z.array(ConsentOut),
    }),
  ),
  teamInvitations: z.array(InvitationOut.extend({ organization: z.string() })),
  notes: z.array(z.string()),
});
export type AccountDocument = z.infer<typeof AccountDocument>;

export interface AccountDocumentParts {
  readonly email: string;
  readonly now: Date;
  readonly identity: unknown;
  readonly orgs: readonly OrgPart[];
}

interface OrgPart {
  readonly name: string;
  readonly membership: { role: string; since: Date } | null;
  readonly preferences: readonly unknown[];
  readonly agreements: readonly unknown[];
  readonly orders: readonly { id: string; eventId: string }[];
  readonly tickets: readonly { eventId: string }[];
  readonly consents: readonly unknown[];
  readonly invitations: readonly unknown[];
  readonly events: Readonly<Record<string, string>>;
}

/** Assemble and allowlist the access document (pure; unit-tested). */
export function buildAccountDocument(parts: AccountDocumentParts): AccountDocument {
  return AccountDocument.parse({
    format: ACCOUNT_FORMAT,
    generatedAt: parts.now,
    controller: 'Yayatoh (Pani Digital Services, LLC)',
    subject: { email: parts.email },
    account: parts.identity ?? null,
    organizations: parts.orgs
      .filter((o) => o.membership)
      .map((o) => ({
        organization: o.name,
        role: o.membership?.role,
        memberSince: o.membership?.since,
        notificationPreferences: o.preferences,
        agreements: o.agreements,
      })),
    purchases: parts.orgs
      .filter((o) => o.orders.length > 0 || o.tickets.length > 0 || o.consents.length > 0)
      .map((o) => ({
        organizer: o.name,
        events: o.events,
        orders: o.orders,
        tickets: o.tickets,
        marketingConsents: o.consents,
      })),
    teamInvitations: parts.orgs.flatMap((o) =>
      o.invitations.map((i) => ({ ...(i as object), organization: o.name })),
    ),
    notes: [
      'Yayatoh is the controller for your account; each organizer is the controller for its own orders, tickets and marketing consents and keeps them after your account is deleted.',
      'Card numbers are never stored by organizers or Yayatoh; payments are processed by Stripe.',
      'Money amounts are in minor units of the order currency (e.g. cents).',
    ],
  });
}

// ─── Reading across orgs ────────────────────────────────────────────────────────────────────

/** Every org holding something about this account or address (ids only, via definer functions). */
export async function accountOrgIds(userId: string | null, emailNorm: string): Promise<string[]> {
  const ids = new Set<string>();
  if (userId) for (const o of await myOrganizations(userId)) ids.add(o.orgId);
  for (const id of await buyerOrgs(userId, emailNorm)) ids.add(id);
  for (const id of await invitationOrgs(emailNorm)) ids.add(id);
  return [...ids];
}

async function orgPartTx(
  tx: TenantTx,
  orgId: string,
  userId: string | null,
  emailNorm: string,
  now: Date,
): Promise<OrgPart> {
  const orders = await buyerOrdersDsarTx(tx, userId, emailNorm);
  const orderIds = new Set(orders.map((o) => o.id));
  // Tickets in their own orders (what the buyer sees on their order page).
  const tickets = (await ticketsDsarTx(tx, emailNorm, [...orderIds])).tickets.filter(
    (t) => t.orderId && orderIds.has(t.orderId),
  );
  const events: Record<string, string> = {};
  for (const id of new Set([...orders.map((o) => o.eventId), ...tickets.map((t) => t.eventId)])) {
    const e = await findEventTx(tx, id);
    if (e) events[id] = e.name;
  }
  return {
    name: (await organizationNameTx(tx, orgId)) ?? '',
    membership: userId ? await accountMembershipTx(tx, userId) : null,
    preferences: userId ? await userPreferencesTx(tx, userId) : [],
    agreements: userId ? await agreementsAcceptedByTx(tx, userId) : [],
    orders,
    tickets,
    consents: (await contactDsarTx(tx, emailNorm)).consents,
    invitations: await invitationsDsarTx(tx, emailNorm, now),
    events,
  };
}

const readCtx = (orgId: string, by: AccountRequestBy) =>
  createCtx({ orgId, actor: { type: 'system', name: actorName(by) } });

/** The document for an account (or, for staff, an address without an account). */
export async function accountDocument(input: {
  readonly user: AccountUser | null;
  readonly email: string;
  readonly by: AccountRequestBy;
  readonly sessionToken?: string | null;
  readonly now?: Date;
}): Promise<AccountDocument> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const userId = input.user?.id ?? null;
  const identity = userId ? await accountIdentityData(userId, input.sessionToken) : null;
  const orgs: OrgPart[] = [];
  for (const orgId of await accountOrgIds(userId, email))
    orgs.push(await withTenant(readCtx(orgId, input.by), (tx) => orgPartTx(tx, orgId, userId, email, now)));
  orgs.sort((a, b) => a.name.localeCompare(b.name));
  return buildAccountDocument({ email, now, identity, orgs });
}

/** Counts per category (the admin console's find, and the request record). */
export function accountSummary(doc: AccountDocument) {
  return {
    account: doc.account ? 1 : 0,
    sessions: doc.account?.sessions.length ?? 0,
    securityEvents: doc.account?.securityEvents.length ?? 0,
    memberships: doc.organizations.length,
    orders: doc.purchases.reduce((n, p) => n + p.orders.length, 0),
    tickets: doc.purchases.reduce((n, p) => n + p.tickets.length, 0),
    consents: doc.purchases.reduce((n, p) => n + p.marketingConsents.length, 0),
    invitations: doc.teamInvitations.length,
  };
}
export type AccountSummary = ReturnType<typeof accountSummary>;

async function recordAccountRequest(
  kind: 'access' | 'erasure',
  email: string,
  by: AccountRequestBy,
  summary: Record<string, number>,
): Promise<string> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ id: string }>(
      sql`select privacy.record_account_request(${kind}, ${addressHash(email)}, ${maskEmail(email)}, ${actorOf(by)}, ${by.type === 'staff' ? by.reason.trim() : null}, ${JSON.stringify(summary)}::jsonb) as id`,
    ),
  );
  const id = rows[0]?.id;
  if (!id) throw new DomainError('internal');
  return id;
}

/**
 * Staff give a reason; a person acting on their own account must have re-authenticated in the
 * last 10 minutes (step-up, roadmap §9): the export holds everything about them, and deletion
 * cannot be undone. Staff are authenticated by the admin console.
 */
function checkBy(by: AccountRequestBy, stepUpAt: Date | null | undefined, now: Date) {
  if (by.type === 'self' && !isStepUpFresh(stepUpAt ?? null, now))
    throw new DomainError('step_up_required', 'Confirm it’s you first');
  if (by.type === 'staff' && !StaffReason.safeParse(by.reason).success)
    throw new DomainError('validation_failed', 'A reason (10–500 characters) is required', {
      field: 'reason',
    });
}

/**
 * Access request for an account: the JSON document, recorded (masked) and, for an account, a
 * security event `account.exported`.
 */
export async function exportAccount(input: {
  readonly userId?: string | null;
  readonly email: string;
  readonly by: AccountRequestBy;
  readonly sessionToken?: string | null;
  /** Self-service: the session's last re-authentication. */
  readonly stepUpAt?: Date | null;
  readonly now?: Date;
}): Promise<{ doc: AccountDocument; fileName: string }> {
  const now = input.now ?? new Date();
  checkBy(input.by, input.stepUpAt, now);
  const user = input.userId ? await findUserById(input.userId) : await findUserByEmail(input.email);
  const live = user && !user.deletedAt ? user : null;
  const email = normalizeEmail(live?.email ?? input.email);
  const doc = await accountDocument({
    user: live,
    email,
    by: input.by,
    sessionToken: input.sessionToken,
    now,
  });
  await recordAccountRequest('access', email, input.by, accountSummary(doc));
  if (live) await recordAccountEvent(live.id, 'account.exported', { by: input.by.type });
  return { doc, fileName: `yayatoh-account-${now.toISOString().slice(0, 10)}.json` };
}

// ─── Erasure ────────────────────────────────────────────────────────────────────────────────

export const DetachResult = z.object({
  role: z.string().nullable(),
  eventRoles: z.int(),
  orders: z.int(),
  contacts: z.int(),
  preferences: z.int(),
  pushTokens: z.int(),
  inboxItems: z.int(),
  invitations: z.int(),
});

/**
 * One org's part of an account deletion, run by the platform (a system actor: the person may
 * only be a buyer there). The membership is removed (refused while they are the last owner),
 * with their event roles, notification choices, device tokens and inbox; orders and contacts
 * stay but lose the account link; invitations addressed to them are deleted or redacted. Audited
 * in the org's chain against the (now pseudonymous) user id.
 */
export const detachAccountCommand = tenantCommand({
  name: 'privacy.detachAccount',
  input: z.object({ userId: z.uuid().nullable(), email: z.string().trim().toLowerCase().max(320) }),
  output: DetachResult,
  entitlement: null,
  permission: 'platform:privacy.account',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const u = input.userId;
    const role = u ? await leaveOrganizationTx(tx, orgId, u) : null;
    const eventRoles = u ? await removeUserEventRolesTx(tx, u) : 0;
    const notes = u
      ? await eraseUserNotificationsTx(tx, u)
      : { preferences: 0, pushTokens: 0, inboxItems: 0 };
    const orders = u ? await unlinkBuyerUserTx(tx, u, ctx.now) : 0;
    const contacts = u ? await unlinkContactUserTx(tx, u, ctx.now) : 0;
    const inv = await eraseInvitationsDsarTx(tx, input.email, ctx.now);
    return { role, eventRoles, orders, contacts, ...notes, invitations: inv.deleted + inv.redacted };
  },
  audit: (input, r) => ({
    action: 'privacy.account_erased',
    targetType: 'user',
    targetId: input.userId,
    data: {
      role: r.role ?? 'none',
      count:
        r.eventRoles + r.orders + r.contacts + r.preferences + r.pushTokens + r.inboxItems + r.invitations,
    },
  }),
});

export const AccountErasure = z.object({
  requestId: z.uuid(),
  summary: z.object({
    organizations: z.int(),
    memberships: z.int(),
    ordersUnlinked: z.int(),
    invitations: z.int(),
    sessions: z.int(),
    credentials: z.int(),
    signupCodes: z.int(),
  }),
});
export type AccountErasure = z.infer<typeof AccountErasure>;

/** The orgs that stop this account from being deleted (the person is their only owner). */
export async function accountDeletionBlockers(userId: string) {
  return soleOwnerOrgs(userId);
}

/**
 * Delete an account (self-service with step-up, or staff with a reason), or erase an address
 * that has no account (staff: invitations only). Refused (`invalid_state`, reason `last_owner`,
 * `orgs`: names) while the person is the only owner of an org. The confirmation goes to the old
 * address first (`notify`); then each org detaches the account, the identity is anonymised, the
 * address joins the platform-wide suppression list and the request is recorded.
 */
export async function deleteAccount(input: {
  readonly userId?: string | null;
  readonly email: string;
  readonly by: AccountRequestBy;
  readonly ports: CommandPorts<TenantTx>;
  readonly notify?: (to: string, user: AccountUser) => Promise<void>;
  /** Self-service: the session's last re-authentication. */
  readonly stepUpAt?: Date | null;
  readonly now?: Date;
}): Promise<AccountErasure> {
  checkBy(input.by, input.stepUpAt, input.now ?? new Date());
  const user = input.userId ? await findUserById(input.userId) : await findUserByEmail(input.email);
  const live = user && !user.deletedAt ? user : null;
  if (input.userId && !live) throw new DomainError('not_found', 'No such account');
  const email = normalizeEmail(live?.email ?? input.email);
  if (live) {
    const blockers = await soleOwnerOrgs(live.id);
    if (blockers.length)
      throw new DomainError('invalid_state', 'The only owner of an organization', {
        reason: 'last_owner',
        orgs: blockers.map((b) => b.name),
      });
  }
  const orgIds = await accountOrgIds(live?.id ?? null, email);
  if (!live && orgIds.length === 0) throw new DomainError('not_found', 'Nothing is held about this email');
  if (live && input.notify) await input.notify(email, live);
  let memberships = 0;
  let ordersUnlinked = 0;
  let invitations = 0;
  for (const orgId of orgIds) {
    const ctx: Ctx = createCtx({
      orgId,
      actor: { type: 'system', name: actorName(input.by) },
      now: input.now,
    });
    const r = await executeCommand(
      detachAccountCommand,
      { userId: live?.id ?? null, email },
      ctx,
      input.ports,
    );
    if (r.role) memberships += 1;
    ordersUnlinked += r.orders;
    invitations += r.invitations;
  }
  const identity = live
    ? await anonymiseAccount(live.id, { by: input.by.type, now: input.now })
    : { sessions: 0, credentials: 0 };
  await markAddressErased(email);
  // Staff notes on invite-only signup codes that mention the address.
  const [codes] = await withoutTenant((tx) =>
    tx.execute<{ n: number }>(sql`select platform.redact_signup_code_notes(${email}) as n`),
  );
  const summary = {
    organizations: orgIds.length,
    memberships,
    ordersUnlinked,
    invitations,
    sessions: identity.sessions,
    credentials: identity.credentials,
    signupCodes: codes?.n ?? 0,
  };
  const requestId = await recordAccountRequest('erasure', email, input.by, summary);
  return { requestId, summary };
}
