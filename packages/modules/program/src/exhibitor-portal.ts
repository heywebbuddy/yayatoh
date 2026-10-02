import type { TenantTx } from '@yayatoh/db';
import {
  createPortalAccountTx,
  type PortalAccountDto,
  type PortalPrincipal,
  portalAccountsTx,
  portalExpiresAt,
  portalPrincipalTx,
  revokePortalAccountTx,
  safeHref,
  sanitizeMarkdown,
} from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { allowanceUse, type MemberRole, type MemberStatus, staffAllowance } from './domain/exhibitors.ts';
import {
  type ExhibitorMemberDto,
  ExhibitorPortalAdminDto,
  ExhibitorSettingsDto,
  InviteResultDto,
  PortalExhibitorViewDto,
  type ProfileProposalDto,
  portalExhibitorViewSerializer,
} from './exhibitor-dto.ts';
import {
  boothAssignments,
  booths,
  EXHIBITOR_MEMBER_ROLES,
  exhibitorProfileChanges,
  exhibitorProfiles,
  exhibitorSettings,
  exhibitors,
} from './schema.ts';
import { portalTaskAssignees, portalTasks } from './schema-portal.ts';
import { eventOf } from './shared.ts';

/**
 * M5.4a exhibitor portal on M5.3a's portal accounts (P5-7). An exhibitor's admins and staff are
 * `events.portal_accounts` rows (subject kind `exhibitor`, role `exhibitor_admin` or
 * `exhibitor_staff`): one event role at one event, invited by email and signed in through the one
 * portal sign-in flow (signed invitation, emailed code or magic link). Organizer commands need
 * `events:write`; portal commands `portal:exhibitor` (both exhibitor roles) or
 * `portal:exhibitor_admin`, and re-check the account and its exhibitor in their transaction.
 */
export const MAX_MEMBERS_PER_EXHIBITOR = 200;

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

/** A portal account as a person of the exhibitor (an expired account holds nothing: revoked). */
const memberStatus = (a: PortalAccountDto): MemberStatus =>
  a.status === 'invited' ? 'pending' : a.status === 'active' ? 'active' : 'revoked';

const toMember = (a: PortalAccountDto, eventEndsAt: Date): ExhibitorMemberDto => ({
  id: a.id,
  exhibitorId: a.subjectId,
  email: a.email,
  role: a.role as MemberRole,
  status: memberStatus(a),
  invitedAt: a.invitedAt,
  lastSignInAt: a.lastSignInAt,
  expiresAt: portalExpiresAt(eventEndsAt),
});

/** The portal accounts of some exhibitors of an event (every status), as people. */
async function membersTx(tx: TenantTx, ctx: Ctx, eventId: string, exhibitorIds: readonly string[]) {
  if (exhibitorIds.length === 0) return [];
  const ids = new Set(exhibitorIds);
  const event = await eventOf(tx, eventId);
  return (await portalAccountsTx(tx, eventId, 'exhibitor', ctx.now))
    .filter((a) => ids.has(a.subjectId))
    .map((a) => toMember(a, event.endsAt));
}

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
 * Invite one person to an exhibitor: a portal account (`createPortalAccountTx`), whose invitation
 * the portal invite mailer emails. Staff take a place under the allowance: the exhibitor row is
 * locked first, so concurrent invites count one after another and stop exactly at it (pending
 * invites count; revoked ones don't). One live account per address and exhibitor.
 */
async function inviteTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  input: { eventId: string; exhibitorId: string; email: string; role: MemberRole },
  by: 'organizer' | 'exhibitor',
): Promise<InviteResultDto> {
  const event = await eventOf(tx, input.eventId);
  const exhibitor = await exhibitorTx(tx, input.eventId, input.exhibitorId, true);
  if (portalExpiresAt(event.endsAt) <= ctx.now)
    throw new DomainError('invalid_state', 'The event is over', { reason: 'event_over' });
  const members = await membersTx(tx, ctx, input.eventId, [exhibitor.id]);
  if (members.some((m) => m.status !== 'revoked' && m.email === input.email))
    throw new DomainError('conflict', 'Already invited', { field: 'email', reason: 'already_invited' });
  if (members.length >= MAX_MEMBERS_PER_EXHIBITOR)
    throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
  if (input.role === 'exhibitor_staff') {
    const use = allowanceUse(
      staffAllowance(
        (await exhibitorSettingsTx(tx, input.eventId)).defaultStaffAllowance,
        (await profileTx(tx, exhibitor.id))?.staffAllowance ?? null,
      ),
      members,
    );
    if (use.left <= 0)
      throw new DomainError('invalid_state', 'The staff allowance is used up', {
        reason: 'allowance_reached',
        allowance: use.allowance,
      });
  }
  const r = await createPortalAccountTx(tx, ctx, {
    eventId: input.eventId,
    role: input.role,
    subjectId: exhibitor.id,
    email: input.email,
  });
  emit(r.event);
  if (input.role === 'exhibitor_staff') emit(staffInvited(input.eventId, exhibitor.id, r.account.id, by));
  return { member: toMember(r.account, event.endsAt), exhibitorName: exhibitor.name, eventName: event.name };
}

/** One person of one exhibitor of the event (any status), or `not_found`. */
async function memberTx(tx: TenantTx, ctx: Ctx, eventId: string, memberId: string) {
  const event = await eventOf(tx, eventId);
  const a = (await portalAccountsTx(tx, eventId, 'exhibitor', ctx.now)).find((m) => m.id === memberId);
  if (!a) throw new DomainError('not_found');
  return toMember(a, event.endsAt);
}

/* ----------------------------------------------------------------- portal principal ---- */

/**
 * The signed-in exhibitor person, re-checked in the command's transaction: a live portal account
 * of this org (`portalPrincipalTx`) with an exhibitor role, whose exhibitor still exists in its
 * event. `admin`: exhibitor admins only. Anything else is `forbidden` (another exhibitor's ids
 * look the same as unknown ones).
 */
export async function exhibitorPrincipalTx(
  tx: TenantTx,
  ctx: Ctx,
  need: 'admin' | 'any' = 'any',
): Promise<{ principal: PortalPrincipal; exhibitor: typeof exhibitors.$inferSelect }> {
  const p = await portalPrincipalTx(tx, ctx);
  const denied = new DomainError('forbidden', 'Not allowed in this portal');
  if (p.subjectKind !== 'exhibitor' || !(EXHIBITOR_MEMBER_ROLES as readonly string[]).includes(p.role))
    throw denied;
  if (need === 'admin' && p.role !== 'exhibitor_admin') throw denied;
  const [exhibitor] = await tx
    .select()
    .from(exhibitors)
    .where(and(eq(exhibitors.id, p.subjectId), eq(exhibitors.eventId, p.eventId)));
  if (!exhibitor) throw denied;
  return { principal: p, exhibitor };
}

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

/**
 * Send a pending or active person a fresh invitation (a new version: the old link stops working),
 * through the portal invite mailer.
 */
export const resendExhibitorInviteCommand = tenantCommand({
  name: 'program.resendExhibitorInvite',
  input: z.object({ eventId: z.uuid(), memberId: z.uuid() }),
  output: InviteResultDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const m = await memberTx(tx, ctx, input.eventId, input.memberId);
    if (m.status === 'revoked') throw new DomainError('not_found');
    const event = await eventOf(tx, input.eventId);
    const exhibitor = await exhibitorTx(tx, input.eventId, m.exhibitorId, true);
    const r = await createPortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      role: m.role,
      subjectId: m.exhibitorId,
      email: m.email,
    });
    emit(r.event);
    return {
      member: toMember(r.account, event.endsAt),
      exhibitorName: exhibitor.name,
      eventName: event.name,
    };
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
    const m = await memberTx(tx, ctx, input.eventId, input.memberId);
    if (m.status === 'revoked') throw new DomainError('not_found');
    await exhibitorTx(tx, input.eventId, m.exhibitorId, true);
    await revokePortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      accountId: m.id,
      subjectKind: 'exhibitor',
    });
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
  handler: async ({ input, ctx, tx }) => {
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
    const members = await membersTx(tx, ctx, input.eventId, ids);
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
          members: mine.filter((m) => m.status !== 'revoked'),
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

/** What the signed-in member sees: their exhibitor, event, booths; admins also their staff. */
export const exhibitorPortalQuery = tenantQuery({
  name: 'program.exhibitorPortal',
  input: z.object({}),
  output: PortalExhibitorViewDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ ctx, tx }) => {
    const { principal: me, exhibitor: x } = await exhibitorPrincipalTx(tx, ctx);
    const event = await eventOf(tx, me.eventId);
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
    const tasks = await tx
      .select({ a: portalTaskAssignees, t: portalTasks })
      .from(portalTaskAssignees)
      .innerJoin(portalTasks, eq(portalTasks.id, portalTaskAssignees.taskId))
      .where(
        and(
          eq(portalTaskAssignees.eventId, me.eventId),
          eq(portalTaskAssignees.subjectId, x.id),
          eq(portalTasks.subjectKind, 'exhibitor'),
        ),
      )
      .orderBy(asc(portalTasks.dueAt));
    const admin = me.role === 'exhibitor_admin';
    const people = admin
      ? (await membersTx(tx, ctx, me.eventId, [x.id])).filter((m) => m.status !== 'revoked')
      : [];
    return portalExhibitorViewSerializer.serialize({
      role: me.role as MemberRole,
      email: me.email,
      event: { name: event.name, timezone: event.timezone, startsAt: event.startsAt, endsAt: event.endsAt },
      exhibitor: { id: x.id, listed: p?.listed ?? true, ...currentProfile(x, p) },
      approvalRequired: settings.approvalRequired,
      pendingChange: proposed?.success ? proposed.data : null,
      tasks: tasks.map(({ a, t }) => ({
        assigneeId: a.id,
        kind: t.kind,
        title: t.title,
        dueAt: t.dueAt,
        status: a.status,
        completedAt: a.completedAt,
      })),
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
            members: people.map(({ exhibitorId: _x, ...rest }) => rest),
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
  input: ProposalInput,
  output: z.object({ status: z.enum(['applied', 'pending']), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input: proposal, ctx, tx }) => {
    const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
    const me = { eventId: principal.eventId, exhibitorId: exhibitor.id, accountId: principal.accountId };
    await exhibitorTx(tx, me.eventId, me.exhibitorId, true);
    const settings = await exhibitorSettingsTx(tx, me.eventId);
    if (!settings.approvalRequired) {
      await applyProfileTx(tx, ctx, me.eventId, me.exhibitorId, proposal);
      return { status: 'applied' as const, exhibitorId: me.exhibitorId };
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
      accountId: me.accountId,
      proposed: proposal,
      status: 'pending',
    });
    return { status: 'pending' as const, exhibitorId: me.exhibitorId };
  },
  audit: (_input, r) => ({
    action: 'program.exhibitor_profile.portal_save',
    targetType: 'program_exhibitor',
    targetId: r?.exhibitorId ?? null,
    data: { status: r?.status },
  }),
});

/** An exhibitor admin invites staff by email, up to the allowance. */
export const portalInviteStaffCommand = tenantCommand({
  name: 'program.portalInviteStaff',
  input: z.object({ email: Email }),
  output: InviteResultDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx, emit }) => {
    const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
    return inviteTx(
      tx,
      ctx,
      emit,
      { eventId: principal.eventId, exhibitorId: exhibitor.id, email: input.email, role: 'exhibitor_staff' },
      'exhibitor',
    );
  },
  // No address in the audit row: the member (account) id is enough to find it.
  audit: (_input, r) => ({
    action: 'program.exhibitor_member.invite',
    targetType: 'program_exhibitor',
    targetId: r?.member.exhibitorId ?? null,
    data: { memberId: r?.member.id, role: 'exhibitor_staff', by: 'exhibitor' },
  }),
});

/** An exhibitor admin revokes one of their own staff (frees a place). */
export const portalRevokeStaffCommand = tenantCommand({
  name: 'program.portalRevokeStaff',
  input: z.object({ memberId: z.uuid() }),
  output: z.object({ revoked: z.boolean(), eventId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx }) => {
    const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
    await exhibitorTx(tx, principal.eventId, exhibitor.id, true);
    const m = (await membersTx(tx, ctx, principal.eventId, [exhibitor.id])).find(
      (x) => x.id === input.memberId && x.role === 'exhibitor_staff' && x.status !== 'revoked',
    );
    // Another exhibitor's people, admins and unknown ids look the same.
    if (!m) throw new DomainError('not_found');
    await revokePortalAccountTx(tx, ctx, {
      eventId: principal.eventId,
      accountId: m.id,
      subjectKind: 'exhibitor',
    });
    return { revoked: true, eventId: principal.eventId };
  },
  audit: (input, r) => ({
    action: 'program.exhibitor_member.revoke',
    targetType: 'event',
    targetId: r?.eventId ?? null,
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
 * Before an exhibitor is deleted: revoke its people's portal accounts (their sessions, links and
 * event roles end), so no live portal access outlives its exhibitor.
 */
export async function endExhibitorRolesTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  exhibitorId: string,
): Promise<void> {
  for (const m of await membersTx(tx, ctx, eventId, [exhibitorId]))
    if (m.status !== 'revoked')
      await revokePortalAccountTx(tx, ctx, { eventId, accountId: m.id, subjectKind: 'exhibitor' });
}
