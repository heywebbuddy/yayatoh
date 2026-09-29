import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import {
  eventRoleAssignmentIdTx,
  findEventTx,
  removeEventRoleTx,
  safeHref,
  sanitizeMarkdown,
  upsertEventRoleTx,
} from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { allowanceUse, type MemberRole, memberExpiry, staffAllowance } from './domain/exhibitors.ts';
import { sameHash } from './domain/portal-token.ts';
import {
  type ExhibitorMemberDto,
  ExhibitorPortalAdminDto,
  ExhibitorSettingsDto,
  InviteResultDto,
  PortalExhibitorViewDto,
  PortalPrincipal,
  type ProfileProposalDto,
  portalExhibitorViewSerializer,
} from './exhibitor-dto.ts';
import {
  boothAssignments,
  booths,
  EXHIBITOR_MEMBER_ROLES,
  exhibitorMembers,
  exhibitorProfileChanges,
  exhibitorProfiles,
  exhibitorSettings,
  exhibitors,
  portalSessions,
} from './schema.ts';
import { eventOf } from './shared.ts';

/** Portal sessions last a week (never past the member's access). */
export const PORTAL_SESSION_MS = 7 * 24 * 3_600_000;
/** A sign-in link asked for from the portal works for 30 minutes (invitations until access ends). */
export const PORTAL_SIGN_IN_LINK_MS = 30 * 60_000;
export const MAX_MEMBERS_PER_EXHIBITOR = 200;

const PORTAL = 'public:exhibitor_portal';
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email address');
const WebUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v) && safeHref(v) !== null, 'must be an http(s) link');
const Links = z
  .array(z.object({ label: z.string().trim().min(1).max(120), url: WebUrl }))
  .max(5)
  .default([]);
const Categories = z
  .array(z.string().trim().min(1).max(40))
  .max(5)
  .default([])
  .transform((list) => [...new Map(list.map((c) => [c.toLowerCase(), c])).values()]);

/* --------------------------------------------------------------------------- helpers ---- */

const toMember = (r: typeof exhibitorMembers.$inferSelect): ExhibitorMemberDto => ({
  id: r.id,
  exhibitorId: r.exhibitorId,
  email: r.email,
  role: r.role as MemberRole,
  status: r.status as ExhibitorMemberDto['status'],
  invitedAt: r.createdAt,
  acceptedAt: r.acceptedAt,
  expiresAt: r.expiresAt,
});

export async function exhibitorSettingsTx(tx: TenantTx, eventId: string): Promise<ExhibitorSettingsDto> {
  const [row] = await tx.select().from(exhibitorSettings).where(eq(exhibitorSettings.eventId, eventId));
  return {
    defaultStaffAllowance: row?.defaultStaffAllowance ?? staffAllowance(null, null),
    approvalRequired: row?.approvalRequired ?? false,
  };
}

/** The exhibitor (of this event), optionally locked for update: invites serialize on it. */
async function exhibitorTx(tx: TenantTx, eventId: string, exhibitorId: string, lock = false) {
  const q = tx
    .select()
    .from(exhibitors)
    .where(and(eq(exhibitors.id, exhibitorId), eq(exhibitors.eventId, eventId)));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError('not_found', 'Exhibitor not found');
  return row;
}

async function profileTx(tx: TenantTx, exhibitorId: string) {
  const [row] = await tx
    .select()
    .from(exhibitorProfiles)
    .where(eq(exhibitorProfiles.exhibitorId, exhibitorId));
  return row ?? null;
}

async function upsertProfileTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  exhibitorId: string,
  set: Partial<
    Pick<typeof exhibitorProfiles.$inferInsert, 'links' | 'categories' | 'listed' | 'staffAllowance'>
  >,
) {
  await tx
    .insert(exhibitorProfiles)
    .values({ orgId: requireOrg(ctx), eventId, exhibitorId, ...set })
    .onConflictDoUpdate({
      target: [exhibitorProfiles.orgId, exhibitorProfiles.exhibitorId],
      set: { ...set, updatedAt: ctx.now },
    });
}

const linksOf = (v: unknown) =>
  z
    .array(z.object({ label: z.string(), url: z.string() }))
    .catch([])
    .parse(v);

function currentProfile(
  x: typeof exhibitors.$inferSelect,
  p: typeof exhibitorProfiles.$inferSelect | null,
): ProfileProposalDto {
  return {
    name: x.name,
    description: x.description,
    websiteUrl: x.websiteUrl,
    links: linksOf(p?.links),
    categories: p?.categories ?? [],
  };
}

async function allowanceTx(tx: TenantTx, eventId: string, exhibitorId: string) {
  const settings = await exhibitorSettingsTx(tx, eventId);
  const own = (await profileTx(tx, exhibitorId))?.staffAllowance ?? null;
  const members = await tx
    .select({ role: exhibitorMembers.role, status: exhibitorMembers.status })
    .from(exhibitorMembers)
    .where(eq(exhibitorMembers.exhibitorId, exhibitorId));
  return allowanceUse(staffAllowance(settings.defaultStaffAllowance, own), members);
}

export function staffInvited(
  eventId: string,
  exhibitorId: string,
  memberId: string,
  by: 'organizer' | 'exhibitor',
): DomainEvent {
  return {
    type: 'program.exhibitor.staff_invited',
    version: 1,
    aggregateType: 'program_exhibitor',
    aggregateId: exhibitorId,
    payload: { eventId, exhibitorId, memberId, by },
  };
}

/**
 * Invite one person to an exhibitor. Staff take a place under the allowance: the exhibitor row is
 * locked first, so concurrent invites count one after another and stop exactly at it (pending
 * invites count; revoked ones don't). The link secret arrives already hashed.
 */
async function inviteTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  input: { eventId: string; exhibitorId: string; email: string; role: MemberRole; linkHash: string },
  by: 'organizer' | 'exhibitor',
): Promise<InviteResultDto> {
  const event = await eventOf(tx, input.eventId);
  const exhibitor = await exhibitorTx(tx, input.eventId, input.exhibitorId, true);
  const expiresAt = memberExpiry(event.endsAt);
  if (expiresAt <= ctx.now)
    throw new DomainError('invalid_state', 'The event is over', { reason: 'event_over' });
  const members = await tx
    .select()
    .from(exhibitorMembers)
    .where(eq(exhibitorMembers.exhibitorId, exhibitor.id));
  if (members.some((m) => m.status !== 'revoked' && m.email.toLowerCase() === input.email))
    throw new DomainError('conflict', 'Already invited', { field: 'email', reason: 'already_invited' });
  if (members.length >= MAX_MEMBERS_PER_EXHIBITOR)
    throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
  if (input.role === 'exhibitor_staff') {
    const use = await allowanceTx(tx, input.eventId, exhibitor.id);
    if (use.left <= 0)
      throw new DomainError('invalid_state', 'The staff allowance is used up', {
        reason: 'allowance_reached',
        allowance: use.allowance,
      });
  }
  let row: typeof exhibitorMembers.$inferSelect | undefined;
  try {
    [row] = await tx
      .insert(exhibitorMembers)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        exhibitorId: exhibitor.id,
        email: input.email,
        role: input.role,
        status: 'pending',
        accountId: uuidv7(),
        linkHash: input.linkHash,
        linkExpiresAt: expiresAt,
        expiresAt,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err))
      throw new DomainError('conflict', 'Already invited', { field: 'email', reason: 'already_invited' });
    throw err;
  }
  if (!row) throw new DomainError('internal');
  if (input.role === 'exhibitor_staff') emit(staffInvited(input.eventId, exhibitor.id, row.id, by));
  return { member: toMember(row), exhibitorName: exhibitor.name, eventName: event.name };
}

/** Revoke a member: its links, sessions and event role end now. */
async function revokeTx(tx: TenantTx, ctx: Ctx, m: typeof exhibitorMembers.$inferSelect) {
  await tx
    .update(exhibitorMembers)
    .set({ status: 'revoked', revokedAt: ctx.now, linkHash: null, linkExpiresAt: null, updatedAt: ctx.now })
    .where(eq(exhibitorMembers.id, m.id));
  await tx
    .update(portalSessions)
    .set({ revokedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(portalSessions.memberId, m.id), isNull(portalSessions.revokedAt)));
  await removeEventRoleTx(tx, { eventId: m.eventId, userId: m.accountId, role: m.role as MemberRole });
}

/* ----------------------------------------------------------------- portal principal ---- */

/**
 * The live member behind a portal principal, re-checked in the command's transaction: same org,
 * an active membership of that exhibitor in that event, not expired, and the named event-role
 * assignment still live. Anything else is `forbidden` (another exhibitor's ids look the same as
 * unknown ones). `admin`: exhibitor admins only.
 */
export async function portalMemberTx(
  tx: TenantTx,
  ctx: Ctx,
  principal: PortalPrincipal,
  need: 'admin' | 'any' = 'any',
): Promise<typeof exhibitorMembers.$inferSelect> {
  const denied = new DomainError('forbidden', 'Not allowed in this portal');
  if (requireOrg(ctx) !== principal.orgId) throw denied;
  if (principal.role !== 'exhibitor_admin' && principal.role !== 'exhibitor_staff') throw denied;
  if (need === 'admin' && principal.role !== 'exhibitor_admin') throw denied;
  const candidates = await tx
    .select()
    .from(exhibitorMembers)
    .where(
      and(
        eq(exhibitorMembers.eventId, principal.eventId),
        eq(exhibitorMembers.exhibitorId, principal.subjectId),
        eq(exhibitorMembers.role, principal.role),
        eq(exhibitorMembers.status, 'active'),
        gt(exhibitorMembers.expiresAt, ctx.now),
      ),
    );
  for (const m of candidates) {
    const id = await eventRoleAssignmentIdTx(tx, {
      eventId: m.eventId,
      userId: m.accountId,
      role: m.role as MemberRole,
      now: ctx.now,
    });
    if (id && id === principal.eventRoleAssignmentId) return m;
  }
  throw denied;
}

/** The principal of a live portal session (by its token's HMAC), or null. */
export async function portalPrincipalBySession(
  orgId: string,
  tokenHash: string,
  now = new Date(),
): Promise<PortalPrincipal | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  const ctx = createCtx({ orgId, now, actor: { type: 'system', name: 'program.portal-session' } });
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ member: exhibitorMembers })
      .from(portalSessions)
      .innerJoin(exhibitorMembers, eq(exhibitorMembers.id, portalSessions.memberId))
      .where(
        and(
          eq(portalSessions.tokenHash, tokenHash),
          isNull(portalSessions.revokedAt),
          gt(portalSessions.expiresAt, now),
          eq(exhibitorMembers.status, 'active'),
          gt(exhibitorMembers.expiresAt, now),
        ),
      );
    if (!row) return null;
    const m = row.member;
    const assignment = await eventRoleAssignmentIdTx(tx, {
      eventId: m.eventId,
      userId: m.accountId,
      role: m.role as MemberRole,
      now,
    });
    if (!assignment) return null;
    return PortalPrincipal.parse({
      orgId,
      eventId: m.eventId,
      eventRoleAssignmentId: assignment,
      role: m.role,
      subjectId: m.exhibitorId,
    });
  });
}

/** Sign one portal browser out. */
export async function endPortalSession(orgId: string, tokenHash: string, now = new Date()): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return;
  const ctx = createCtx({ orgId, now, actor: { type: 'system', name: 'program.portal-session' } });
  await withTenant(ctx, (tx) =>
    tx
      .update(portalSessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(portalSessions.tokenHash, tokenHash), isNull(portalSessions.revokedAt))),
  );
}

/* ------------------------------------------------------------------ sign-in (links) ---- */

/**
 * Open an invitation or sign-in link (P5-7): the member becomes active, gets its event role (until
 * the event's end + 90 days) and a portal session. The link is spent. A revoked member, a spent,
 * replaced or expired link, or a wrong secret is refused the same way.
 */
export const openExhibitorLinkCommand = tenantCommand({
  name: 'program.openExhibitorLink',
  input: z.object({ memberId: z.uuid(), linkHash: Hash, sessionHash: Hash }),
  output: PortalPrincipal,
  entitlement: 'exhibitors',
  permission: PORTAL,
  handler: async ({ input, ctx, tx }) => {
    const refused = new DomainError('invalid_state', 'This link has expired or was already used', {
      reason: 'link_invalid',
    });
    const [m] = await tx
      .select()
      .from(exhibitorMembers)
      .where(eq(exhibitorMembers.id, input.memberId))
      .for('update');
    if (
      !m ||
      m.status === 'revoked' ||
      !m.linkExpiresAt ||
      m.linkExpiresAt <= ctx.now ||
      m.expiresAt <= ctx.now ||
      !sameHash(m.linkHash, input.linkHash)
    )
      throw refused;
    if (!(await findEventTx(tx, m.eventId))) throw refused;
    const role = m.role as MemberRole;
    await tx
      .update(exhibitorMembers)
      .set({
        status: 'active',
        acceptedAt: m.acceptedAt ?? ctx.now,
        linkHash: null,
        linkExpiresAt: null,
        updatedAt: ctx.now,
      })
      .where(eq(exhibitorMembers.id, m.id));
    await upsertEventRoleTx(tx, {
      orgId: requireOrg(ctx),
      eventId: m.eventId,
      userId: m.accountId,
      role,
      checkpointIds: [],
      expiresAt: m.expiresAt,
      now: ctx.now,
    });
    const assignment = await eventRoleAssignmentIdTx(tx, {
      eventId: m.eventId,
      userId: m.accountId,
      role,
      now: ctx.now,
    });
    if (!assignment) throw new DomainError('internal');
    await tx.insert(portalSessions).values({
      orgId: requireOrg(ctx),
      memberId: m.id,
      tokenHash: input.sessionHash,
      expiresAt: new Date(Math.min(ctx.now.getTime() + PORTAL_SESSION_MS, m.expiresAt.getTime())),
    });
    return {
      orgId: requireOrg(ctx),
      eventId: m.eventId,
      eventRoleAssignmentId: assignment,
      role,
      subjectId: m.exhibitorId,
    };
  },
  audit: (input, r) => ({
    action: 'program.exhibitor_member.sign_in',
    targetType: 'event',
    targetId: r?.eventId ?? null,
    data: { memberId: input.memberId, role: r?.role },
  }),
});

/**
 * "Email me a sign-in link" on the portal's sign-in page: when the address belongs to a live
 * member of the event, its link is replaced by a new one (30 minutes). The answer shown is the
 * same either way; only the caller learns whom to email.
 */
export const requestExhibitorLinkCommand = tenantCommand({
  name: 'program.requestExhibitorLink',
  input: z.object({ eventId: z.uuid(), email: Email, linkHash: Hash }),
  output: z.object({ memberId: z.uuid().nullable(), eventName: z.string().nullable() }),
  entitlement: 'exhibitors',
  permission: PORTAL,
  handler: async ({ input, ctx, tx }) => {
    const [m] = await tx
      .select()
      .from(exhibitorMembers)
      .where(
        and(
          eq(exhibitorMembers.eventId, input.eventId),
          sql`lower(${exhibitorMembers.email}) = ${input.email}`,
          ne(exhibitorMembers.status, 'revoked'),
          gt(exhibitorMembers.expiresAt, ctx.now),
        ),
      )
      .orderBy(desc(exhibitorMembers.createdAt))
      .limit(1);
    const event = await findEventTx(tx, input.eventId);
    if (!m || !event) return { memberId: null, eventName: null };
    await tx
      .update(exhibitorMembers)
      .set({
        linkHash: input.linkHash,
        linkExpiresAt: new Date(Math.min(ctx.now.getTime() + PORTAL_SIGN_IN_LINK_MS, m.expiresAt.getTime())),
        updatedAt: ctx.now,
      })
      .where(eq(exhibitorMembers.id, m.id));
    return { memberId: m.id, eventName: event.name };
  },
  audit: (input, r) => ({
    action: 'program.exhibitor_member.link_requested',
    targetType: 'event',
    targetId: input.eventId,
    data: { memberId: r?.memberId ?? null },
  }),
});

/* ------------------------------------------------------------------ organizer side ---- */

export const saveExhibitorSettingsCommand = tenantCommand({
  name: 'program.saveExhibitorSettings',
  input: z.object({
    eventId: z.uuid(),
    defaultStaffAllowance: z.number().int().min(0).max(500),
    approvalRequired: z.boolean(),
  }),
  output: ExhibitorSettingsDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const { eventId, ...set } = input;
    await tx
      .insert(exhibitorSettings)
      .values({ orgId: requireOrg(ctx), eventId, ...set })
      .onConflictDoUpdate({
        target: [exhibitorSettings.orgId, exhibitorSettings.eventId],
        set: { ...set, updatedAt: ctx.now },
      });
    return set;
  },
  audit: (input) => ({
    action: 'program.exhibitor_settings.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { defaultStaffAllowance: input.defaultStaffAllowance, approvalRequired: input.approvalRequired },
  }),
});

/** The organizer's portal fields of one exhibitor: listing, categories, links and own allowance. */
export const saveExhibitorListingCommand = tenantCommand({
  name: 'program.saveExhibitorListing',
  input: z.object({
    eventId: z.uuid(),
    exhibitorId: z.uuid(),
    listed: z.boolean(),
    categories: Categories,
    links: Links,
    staffAllowance: z.number().int().min(0).max(500).nullable(),
  }),
  output: z.object({ exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, exhibitorId, ...set } = input;
    await exhibitorTx(tx, eventId, exhibitorId, true);
    await upsertProfileTx(tx, ctx, eventId, exhibitorId, set);
    return { exhibitorId };
  },
  audit: (input) => ({
    action: 'program.exhibitor_listing.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { exhibitorId: input.exhibitorId, listed: input.listed, staffAllowance: input.staffAllowance },
  }),
});

export const inviteExhibitorMemberCommand = tenantCommand({
  name: 'program.inviteExhibitorMember',
  input: z.object({
    eventId: z.uuid(),
    exhibitorId: z.uuid(),
    email: Email,
    role: z.enum(EXHIBITOR_MEMBER_ROLES),
    linkHash: Hash,
  }),
  output: InviteResultDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: ({ input, ctx, tx, emit }) => inviteTx(tx, ctx, emit, input, 'organizer'),
  audit: (input, r) => ({
    action: 'program.exhibitor_member.invite',
    targetType: 'event',
    targetId: input.eventId,
    data: { exhibitorId: input.exhibitorId, memberId: r?.member.id, role: input.role },
  }),
});

/** Send a pending or active member a fresh link (the old one stops working). */
export const resendExhibitorInviteCommand = tenantCommand({
  name: 'program.resendExhibitorInvite',
  input: z.object({ eventId: z.uuid(), memberId: z.uuid(), linkHash: Hash }),
  output: InviteResultDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [m] = await tx
      .select()
      .from(exhibitorMembers)
      .where(and(eq(exhibitorMembers.id, input.memberId), eq(exhibitorMembers.eventId, input.eventId)))
      .for('update');
    if (!m || m.status === 'revoked') throw new DomainError('not_found');
    if (m.expiresAt <= ctx.now)
      throw new DomainError('invalid_state', 'The event is over', { reason: 'event_over' });
    const [row] = await tx
      .update(exhibitorMembers)
      .set({ linkHash: input.linkHash, linkExpiresAt: m.expiresAt, updatedAt: ctx.now })
      .where(eq(exhibitorMembers.id, m.id))
      .returning();
    const event = await eventOf(tx, input.eventId);
    const exhibitor = await exhibitorTx(tx, input.eventId, m.exhibitorId);
    if (!row) throw new DomainError('internal');
    return { member: toMember(row), exhibitorName: exhibitor.name, eventName: event.name };
  },
  audit: (input) => ({
    action: 'program.exhibitor_member.resend',
    targetType: 'event',
    targetId: input.eventId,
    data: { memberId: input.memberId },
  }),
});

export const revokeExhibitorMemberCommand = tenantCommand({
  name: 'program.revokeExhibitorMember',
  input: z.object({ eventId: z.uuid(), memberId: z.uuid() }),
  output: z.object({ revoked: z.boolean() }),
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [m] = await tx
      .select()
      .from(exhibitorMembers)
      .where(and(eq(exhibitorMembers.id, input.memberId), eq(exhibitorMembers.eventId, input.eventId)))
      .for('update');
    if (!m || m.status === 'revoked') throw new DomainError('not_found');
    await exhibitorTx(tx, input.eventId, m.exhibitorId, true);
    await revokeTx(tx, ctx, m);
    return { revoked: true };
  },
  audit: (input) => ({
    action: 'program.exhibitor_member.revoke',
    targetType: 'event',
    targetId: input.eventId,
    data: { memberId: input.memberId, by: 'organizer' },
  }),
});

/** Apply or reject an exhibitor's proposed profile. Applying writes the exhibitor and its profile. */
export const decideProfileChangeCommand = tenantCommand({
  name: 'program.decideProfileChange',
  input: z.object({
    eventId: z.uuid(),
    changeId: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    reason: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .default(null)
      .transform((v) => v || null),
  }),
  output: z.object({ status: z.enum(['approved', 'rejected']) }),
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [c] = await tx
      .select()
      .from(exhibitorProfileChanges)
      .where(
        and(
          eq(exhibitorProfileChanges.id, input.changeId),
          eq(exhibitorProfileChanges.eventId, input.eventId),
          eq(exhibitorProfileChanges.status, 'pending'),
        ),
      )
      .for('update');
    if (!c) throw new DomainError('not_found');
    const status = input.decision === 'approve' ? ('approved' as const) : ('rejected' as const);
    if (status === 'approved')
      await applyProfileTx(tx, ctx, c.eventId, c.exhibitorId, ProposalInput.parse(c.proposed));
    await tx
      .update(exhibitorProfileChanges)
      .set({ status, decidedAt: ctx.now, reason: input.reason, updatedAt: ctx.now })
      .where(eq(exhibitorProfileChanges.id, c.id));
    return { status };
  },
  audit: (input, r) => ({
    action: 'program.exhibitor_profile.decide',
    targetType: 'event',
    targetId: input.eventId,
    data: { changeId: input.changeId, status: r?.status },
  }),
});

const ProposalInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .max(3000)
    .transform((v) => sanitizeMarkdown(v, 3000))
    .default(''),
  websiteUrl: z
    .union([WebUrl, z.literal('')])
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
  links: Links,
  categories: Categories,
});

async function applyProfileTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  exhibitorId: string,
  p: z.output<typeof ProposalInput>,
) {
  const rows = await tx
    .update(exhibitors)
    .set({ name: p.name, description: p.description, websiteUrl: p.websiteUrl, updatedAt: ctx.now })
    .where(and(eq(exhibitors.id, exhibitorId), eq(exhibitors.eventId, eventId)))
    .returning({ id: exhibitors.id });
  if (rows.length === 0) throw new DomainError('not_found');
  await upsertProfileTx(tx, ctx, eventId, exhibitorId, { links: p.links, categories: p.categories });
}

/** The organizer's portal page: settings, and per exhibitor its listing, people and pending change. */
export const exhibitorPortalAdminQuery = tenantQuery({
  name: 'program.exhibitorPortalAdmin',
  input: z.object({ eventId: z.uuid() }),
  output: ExhibitorPortalAdminDto,
  entitlement: 'exhibitors',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    const settings = await exhibitorSettingsTx(tx, input.eventId);
    const list = await tx
      .select()
      .from(exhibitors)
      .where(eq(exhibitors.eventId, input.eventId))
      .orderBy(asc(exhibitors.name), asc(exhibitors.createdAt));
    const ids = list.map((x) => x.id);
    const profiles = ids.length
      ? await tx.select().from(exhibitorProfiles).where(inArray(exhibitorProfiles.exhibitorId, ids))
      : [];
    const members = ids.length
      ? await tx
          .select()
          .from(exhibitorMembers)
          .where(inArray(exhibitorMembers.exhibitorId, ids))
          .orderBy(asc(exhibitorMembers.createdAt))
      : [];
    const changes = ids.length
      ? await tx
          .select()
          .from(exhibitorProfileChanges)
          .where(
            and(
              inArray(exhibitorProfileChanges.exhibitorId, ids),
              eq(exhibitorProfileChanges.status, 'pending'),
            ),
          )
      : [];
    return {
      settings,
      exhibitors: list.map((x) => {
        const p = profiles.find((r) => r.exhibitorId === x.id) ?? null;
        const mine = members.filter((m) => m.exhibitorId === x.id);
        const change = changes.find((c) => c.exhibitorId === x.id);
        const proposed = change ? ProposalInput.safeParse(change.proposed) : null;
        return {
          exhibitorId: x.id,
          name: x.name,
          listed: p?.listed ?? true,
          categories: p?.categories ?? [],
          links: linksOf(p?.links),
          staffAllowance: p?.staffAllowance ?? null,
          staff: allowanceUse(staffAllowance(settings.defaultStaffAllowance, p?.staffAllowance), mine),
          members: mine.filter((m) => m.status !== 'revoked').map(toMember),
          pendingChange:
            change && proposed?.success
              ? { id: change.id, proposed: proposed.data, submittedAt: change.createdAt }
              : null,
          current: currentProfile(x, p),
        };
      }),
    };
  },
});

/* ---------------------------------------------------------------------- portal side ---- */

const Principal = { principal: PortalPrincipal };

/** What the signed-in member sees: their exhibitor, event, booths; admins also their staff. */
export const exhibitorPortalQuery = tenantQuery({
  name: 'program.exhibitorPortal',
  input: z.object(Principal),
  output: PortalExhibitorViewDto,
  entitlement: 'exhibitors',
  permission: PORTAL,
  handler: async ({ input, ctx, tx }) => {
    const me = await portalMemberTx(tx, ctx, input.principal);
    const event = await eventOf(tx, me.eventId);
    const x = await exhibitorTx(tx, me.eventId, me.exhibitorId);
    const p = await profileTx(tx, x.id);
    const settings = await exhibitorSettingsTx(tx, me.eventId);
    const [change] = await tx
      .select()
      .from(exhibitorProfileChanges)
      .where(
        and(eq(exhibitorProfileChanges.exhibitorId, x.id), eq(exhibitorProfileChanges.status, 'pending')),
      );
    const proposed = change ? ProposalInput.safeParse(change.proposed) : null;
    const mine = await tx
      .select({ booth: booths, isPrimary: boothAssignments.isPrimary })
      .from(boothAssignments)
      .innerJoin(booths, eq(booths.id, boothAssignments.boothId))
      .where(eq(boothAssignments.exhibitorId, x.id))
      .orderBy(asc(booths.number));
    const admin = me.role === 'exhibitor_admin';
    const people = admin
      ? await tx
          .select()
          .from(exhibitorMembers)
          .where(and(eq(exhibitorMembers.exhibitorId, x.id), ne(exhibitorMembers.status, 'revoked')))
          .orderBy(asc(exhibitorMembers.createdAt))
      : [];
    return portalExhibitorViewSerializer.serialize({
      role: me.role as MemberRole,
      email: me.email,
      event: { name: event.name, timezone: event.timezone, startsAt: event.startsAt, endsAt: event.endsAt },
      exhibitor: { id: x.id, listed: p?.listed ?? true, ...currentProfile(x, p) },
      approvalRequired: settings.approvalRequired,
      pendingChange: proposed?.success ? proposed.data : null,
      booths: mine.map((b) => ({
        number: b.booth.number,
        category: b.booth.category,
        width: b.booth.width,
        height: b.booth.height,
        primary: b.isPrimary,
      })),
      staff: admin
        ? {
            allowance: allowanceUse(
              staffAllowance(settings.defaultStaffAllowance, p?.staffAllowance),
              people,
            ),
            members: people.map((m) => {
              const { exhibitorId: _x, ...rest } = toMember(m);
              return rest;
            }),
          }
        : null,
    });
  },
});

/**
 * An exhibitor admin edits their profile. When the event requires approval the edit waits as the
 * exhibitor's one pending change (a newer edit replaces it); otherwise it applies at once.
 */
export const portalSaveProfileCommand = tenantCommand({
  name: 'program.portalSaveProfile',
  input: ProposalInput.extend(Principal),
  output: z.object({ status: z.enum(['applied', 'pending']) }),
  entitlement: 'exhibitors',
  permission: PORTAL,
  handler: async ({ input, ctx, tx }) => {
    const { principal, ...proposal } = input;
    const me = await portalMemberTx(tx, ctx, principal, 'admin');
    await exhibitorTx(tx, me.eventId, me.exhibitorId, true);
    const settings = await exhibitorSettingsTx(tx, me.eventId);
    if (!settings.approvalRequired) {
      await applyProfileTx(tx, ctx, me.eventId, me.exhibitorId, proposal);
      return { status: 'applied' as const };
    }
    await tx
      .delete(exhibitorProfileChanges)
      .where(
        and(
          eq(exhibitorProfileChanges.exhibitorId, me.exhibitorId),
          eq(exhibitorProfileChanges.status, 'pending'),
        ),
      );
    await tx.insert(exhibitorProfileChanges).values({
      orgId: requireOrg(ctx),
      eventId: me.eventId,
      exhibitorId: me.exhibitorId,
      memberId: me.id,
      proposed: proposal,
      status: 'pending',
    });
    return { status: 'pending' as const };
  },
  audit: (input, r) => ({
    action: 'program.exhibitor_profile.portal_save',
    targetType: 'event',
    targetId: input.principal.eventId,
    data: { exhibitorId: input.principal.subjectId, status: r?.status },
  }),
});

/** An exhibitor admin invites staff by email, up to the allowance. */
export const portalInviteStaffCommand = tenantCommand({
  name: 'program.portalInviteStaff',
  input: z.object({ ...Principal, email: Email, linkHash: Hash }),
  output: InviteResultDto,
  entitlement: 'exhibitors',
  permission: PORTAL,
  handler: async ({ input, ctx, tx, emit }) => {
    const me = await portalMemberTx(tx, ctx, input.principal, 'admin');
    return inviteTx(
      tx,
      ctx,
      emit,
      {
        eventId: me.eventId,
        exhibitorId: me.exhibitorId,
        email: input.email,
        role: 'exhibitor_staff',
        linkHash: input.linkHash,
      },
      'exhibitor',
    );
  },
  audit: (input, r) => ({
    action: 'program.exhibitor_member.invite',
    targetType: 'event',
    targetId: input.principal.eventId,
    data: {
      exhibitorId: input.principal.subjectId,
      memberId: r?.member.id,
      role: 'exhibitor_staff',
      by: 'exhibitor',
    },
  }),
});

/** An exhibitor admin revokes one of their own staff (frees a place). */
export const portalRevokeStaffCommand = tenantCommand({
  name: 'program.portalRevokeStaff',
  input: z.object({ ...Principal, memberId: z.uuid() }),
  output: z.object({ revoked: z.boolean() }),
  entitlement: 'exhibitors',
  permission: PORTAL,
  handler: async ({ input, ctx, tx }) => {
    const me = await portalMemberTx(tx, ctx, input.principal, 'admin');
    await exhibitorTx(tx, me.eventId, me.exhibitorId, true);
    const [m] = await tx
      .select()
      .from(exhibitorMembers)
      .where(
        and(
          eq(exhibitorMembers.id, input.memberId),
          eq(exhibitorMembers.exhibitorId, me.exhibitorId),
          eq(exhibitorMembers.role, 'exhibitor_staff'),
          ne(exhibitorMembers.status, 'revoked'),
        ),
      )
      .for('update');
    // Another exhibitor's people, admins and unknown ids look the same.
    if (!m) throw new DomainError('not_found');
    await revokeTx(tx, ctx, m);
    return { revoked: true };
  },
  audit: (input) => ({
    action: 'program.exhibitor_member.revoke',
    targetType: 'event',
    targetId: input.principal.eventId,
    data: { memberId: input.memberId, by: 'exhibitor' },
  }),
});

/** Exhibitors hidden from the public (listed = false): the public program and map leave them out. */
export async function unlistedExhibitorIdsTx(tx: TenantTx, eventId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: exhibitorProfiles.exhibitorId })
    .from(exhibitorProfiles)
    .where(and(eq(exhibitorProfiles.eventId, eventId), eq(exhibitorProfiles.listed, false)));
  return new Set(rows.map((r) => r.id));
}

/** The categories of every exhibitor of an event that has a profile (booth warnings). */
export async function exhibitorCategoriesTx(tx: TenantTx, eventId: string): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({ id: exhibitorProfiles.exhibitorId, categories: exhibitorProfiles.categories })
    .from(exhibitorProfiles)
    .where(eq(exhibitorProfiles.eventId, eventId));
  return new Map(rows.map((r) => [r.id, r.categories]));
}

/**
 * Before an exhibitor is deleted (its people cascade with it): end its people's event roles, so
 * no live portal assignment outlives its member.
 */
export async function endExhibitorRolesTx(tx: TenantTx, exhibitorId: string): Promise<void> {
  const people = await tx
    .select()
    .from(exhibitorMembers)
    .where(and(eq(exhibitorMembers.exhibitorId, exhibitorId), ne(exhibitorMembers.status, 'revoked')));
  for (const m of people)
    await removeEventRoleTx(tx, { eventId: m.eventId, userId: m.accountId, role: m.role as MemberRole });
}
