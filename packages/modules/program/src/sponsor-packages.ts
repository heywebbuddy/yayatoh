import type { TenantTx } from '@yayatoh/db';
import {
  createPortalAccountTx,
  type EventDto,
  portalAccountsTx,
  revokePortalAccountTx,
} from '@yayatoh/events';
import { actorId, type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type Allowances,
  isOverdue,
  PURCHASE_HOLD_MINUTES,
  packagesLeft,
  snapshotAllowances,
  templateDueAt,
} from './domain/sponsorship.ts';
import { exhibitors, sessions, sponsors, sponsorTiers } from './schema.ts';
import {
  DELIVERABLE_OWNERS,
  LOGO_PLACEMENTS,
  type LogoPlacement,
  sponsorDeliverables,
  sponsorGrants,
  sponsoredSessions,
  sponsorPackages,
  sponsorProfiles,
} from './schema-sponsors.ts';
import { eventOf } from './shared.ts';
import { sponsorPrincipalTx } from './sponsor-allowances.ts';
import {
  type AddonOfferDto,
  type DeliverableTemplateDto,
  type GrantDto,
  SponsorContactDto,
  type SponsorPackageDto,
  SponsorshipAdminDto,
} from './sponsor-dto.ts';

/**
 * M5.4b sponsor packages (program's sponsors area, ADR 0021). A sponsor tier ("Gold") gets package
 * terms: a price (sold online through an add-on order, or granted by the organizer), how many are
 * sold, and its allowances. A grant snapshots the allowances for one sponsor; activating it moves
 * the sponsor to the tier, adds the package's deliverables and emits
 * `program.sponsor_package.activated@1` (registration makes the comp registration code from it).
 * Organizer commands need `events:write`; reads `events:read`; all need the `sponsors` module key.
 */
export const MAX_CONTACTS_PER_SPONSOR = 10;
export const MAX_TEMPLATE_DELIVERABLES = 10;

type GrantRow = typeof sponsorGrants.$inferSelect;
type PackageRow = typeof sponsorPackages.$inferSelect;
type Emit = (e: DomainEvent) => void;

const Allowance = z.int().min(0).max(500);
export const DeliverableTemplate = z.object({
  title: z.string().trim().min(1).max(120),
  owner: z.enum(DELIVERABLE_OWNERS),
  daysBefore: z.int().min(0).max(365),
});
const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email address');

const templatesOf = (v: unknown): DeliverableTemplateDto[] =>
  z.array(DeliverableTemplate).catch([]).parse(v);

export const allowancesOf = (r: {
  compRegistrations: number;
  exhibitorBadges: number;
  leadLicenses: number;
  logoPlacements: string[];
  sessionSlots: number;
}) =>
  snapshotAllowances({ ...r, logoPlacements: r.logoPlacements }) as Allowances & {
    logoPlacements: LogoPlacement[];
  };

export const grantDto = (g: GrantRow, packageName: string): GrantDto => ({
  id: g.id,
  tierId: g.tierId,
  packageName,
  status: g.status as GrantDto['status'],
  source: g.source as GrantDto['source'],
  priceMinor: g.priceMinor,
  currency: g.currency,
  allowances: allowancesOf(g),
  activatedAt: g.activatedAt,
  note: g.note,
  compCode: g.compCode,
});

/* ------------------------------------------------------------------------- events ---- */

const grantPayload = (g: GrantRow) => ({
  grantId: g.id,
  eventId: g.eventId,
  sponsorId: g.sponsorId,
  tierId: g.tierId,
  compRegistrations: g.compRegistrations,
  compPromoCodeId: g.compPromoCodeId,
  source: g.source,
});

/** `program.sponsor_package.activated@1`: a sponsor holds a package (paid or granted). */
export const packageActivated = (g: GrantRow): DomainEvent => ({
  type: 'program.sponsor_package.activated',
  version: 1,
  aggregateType: 'program_sponsor_grant',
  aggregateId: g.id,
  payload: grantPayload(g),
});

/** `program.sponsor_package.cancelled@1`: the package's allowances end (its comp code closes). */
export const packageCancelled = (g: GrantRow): DomainEvent => ({
  type: 'program.sponsor_package.cancelled',
  version: 1,
  aggregateType: 'program_sponsor_grant',
  aggregateId: g.id,
  payload: grantPayload(g),
});

/* ------------------------------------------------------------------------ helpers ---- */

async function sponsorTx(tx: TenantTx, eventId: string, sponsorId: string, lock = false) {
  const q = tx
    .select()
    .from(sponsors)
    .where(and(eq(sponsors.id, sponsorId), eq(sponsors.eventId, eventId)));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError('not_found', 'Sponsor not found');
  return row;
}

async function tierTx(tx: TenantTx, eventId: string, tierId: string) {
  const [row] = await tx
    .select()
    .from(sponsorTiers)
    .where(and(eq(sponsorTiers.id, tierId), eq(sponsorTiers.eventId, eventId)));
  if (!row) throw new DomainError('not_found', 'Package not found');
  return row;
}

/** The tier's package terms, locked (sales of one package serialize on it). */
async function packageTx(tx: TenantTx, eventId: string, tierId: string, lock = false) {
  const q = tx
    .select()
    .from(sponsorPackages)
    .where(and(eq(sponsorPackages.tierId, tierId), eq(sponsorPackages.eventId, eventId)));
  const [row] = await (lock ? q.for('update') : q);
  if (!row)
    throw new DomainError('invalid_state', 'This package has no terms yet', { reason: 'no_terms' });
  return row;
}

async function leftOfTx(tx: TenantTx, pkg: PackageRow, now: Date, except?: string) {
  const grants = await tx
    .select({ id: sponsorGrants.id, status: sponsorGrants.status, holdUntil: sponsorGrants.holdUntil })
    .from(sponsorGrants)
    .where(eq(sponsorGrants.tierId, pkg.tierId));
  return packagesLeft(
    pkg.quantity,
    grants.filter((g) => g.id !== except),
    now,
  );
}

/** The sponsor's grants that still count: active, and a pending purchase whose hold is live. */
async function currentGrantsTx(tx: TenantTx, sponsorId: string, now: Date) {
  const rows = await tx
    .select()
    .from(sponsorGrants)
    .where(and(eq(sponsorGrants.sponsorId, sponsorId), inArray(sponsorGrants.status, ['active', 'pending'])))
    .for('update');
  const active = rows.find((g) => g.status === 'active') ?? null;
  const pending = rows.find((g) => g.status === 'pending') ?? null;
  // A lapsed purchase hold frees the sponsor for another one (a late payment finds it cancelled).
  if (pending?.holdUntil && pending.holdUntil <= now) {
    await tx
      .update(sponsorGrants)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(eq(sponsorGrants.id, pending.id));
    return { active, pending: null };
  }
  return { active, pending };
}

/**
 * What activating a grant does besides its status: the sponsor moves to the package's tier, the
 * package's deliverables are added (due before the event's first day, in its zone), and
 * `program.sponsor_package.activated@1` is emitted.
 */
async function activateEffectsTx(tx: TenantTx, ctx: Ctx, g: GrantRow, event: EventDto, emit: Emit) {
  await tx
    .update(sponsors)
    .set({ tierId: g.tierId, updatedAt: ctx.now })
    .where(eq(sponsors.id, g.sponsorId));
  const [pkg] = await tx.select().from(sponsorPackages).where(eq(sponsorPackages.tierId, g.tierId));
  const templates = templatesOf(pkg?.deliverables);
  if (templates.length)
    await tx.insert(sponsorDeliverables).values(
      templates.map((d) => ({
        orgId: requireOrg(ctx),
        eventId: g.eventId,
        sponsorId: g.sponsorId,
        title: d.title,
        owner: d.owner,
        dueAt: templateDueAt(event.startsAt, d.daysBefore, event.timezone),
        fromPackage: true,
      })),
    );
  emit(packageActivated(g));
}

/* ------------------------------------------------------------------ organizer side ---- */

export const SavePackageInput = z.object({
  eventId: z.uuid(),
  tierId: z.uuid(),
  description: z.string().trim().max(1000).default(''),
  priceMinor: z.int().min(1).max(100_000_000_000).nullable(),
  quantity: z.int().min(1).max(999).nullable(),
  onSale: z.boolean(),
  compRegistrations: Allowance,
  exhibitorBadges: Allowance,
  leadLicenses: Allowance,
  logoPlacements: z
    .array(z.enum(LOGO_PLACEMENTS))
    .max(LOGO_PLACEMENTS.length)
    .default([])
    .transform((l) => [...new Set(l)]),
  sessionSlots: z.int().min(0).max(20),
  deliverables: z.array(DeliverableTemplate).max(MAX_TEMPLATE_DELIVERABLES).default([]),
});

/** Set a tier's package terms (price in the event's currency). On sale needs a price. */
export const saveSponsorPackageCommand = tenantCommand({
  name: 'program.saveSponsorPackage',
  input: SavePackageInput,
  output: z.object({ tierId: z.uuid() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await eventOf(tx, input.eventId);
    await tierTx(tx, input.eventId, input.tierId);
    if (input.onSale && input.priceMinor === null)
      throw new DomainError('validation_failed', 'A package on sale needs a price', {
        field: 'priceMinor',
        reason: 'price_required',
      });
    const { eventId, tierId, ...set } = input;
    await tx
      .insert(sponsorPackages)
      .values({ orgId: requireOrg(ctx), eventId, tierId, currency: event.currency, ...set })
      .onConflictDoUpdate({
        target: [sponsorPackages.orgId, sponsorPackages.tierId],
        set: { ...set, currency: event.currency, updatedAt: ctx.now },
      });
    return { tierId };
  },
  audit: (input) => ({
    action: 'program.sponsor_package.save',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      tierId: input.tierId,
      priceMinor: input.priceMinor,
      quantity: input.quantity,
      onSale: input.onSale,
    },
  }),
});

/**
 * The organizer grants a sponsor a package (paid outside Yayatoh, or complimentary): active at
 * once with the package's allowances, within the package's quantity.
 */
export const grantSponsorPackageCommand = tenantCommand({
  name: 'program.grantSponsorPackage',
  input: z.object({
    eventId: z.uuid(),
    sponsorId: z.uuid(),
    tierId: z.uuid(),
    note: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .default(null)
      .transform((v) => v || null),
  }),
  output: z.object({ grantId: z.uuid() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const event = await eventOf(tx, input.eventId);
    await sponsorTx(tx, input.eventId, input.sponsorId, true);
    await tierTx(tx, input.eventId, input.tierId);
    const pkg = await packageTx(tx, input.eventId, input.tierId, true);
    const { active, pending } = await currentGrantsTx(tx, input.sponsorId, ctx.now);
    if (active)
      throw new DomainError('conflict', 'This sponsor already holds a package', { reason: 'already_granted' });
    if (pending)
      throw new DomainError('invalid_state', 'A purchase is waiting for payment', {
        reason: 'purchase_pending',
      });
    if ((await leftOfTx(tx, pkg, ctx.now)) === 0)
      throw new DomainError('invalid_state', 'This package is sold out', { reason: 'sold_out' });
    const [g] = await tx
      .insert(sponsorGrants)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        sponsorId: input.sponsorId,
        tierId: input.tierId,
        status: 'active',
        source: 'organizer',
        priceMinor: 0,
        currency: pkg.currency,
        ...allowancesOf(pkg),
        activatedAt: ctx.now,
        grantedBy: actorId(ctx.actor),
        note: input.note,
      })
      .returning();
    if (!g) throw new DomainError('internal');
    await activateEffectsTx(tx, ctx, g, event, emit);
    return { grantId: g.id };
  },
  audit: (input, r) => ({
    action: 'program.sponsor_package.grant',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId, tierId: input.tierId, grantId: r?.grantId },
  }),
});

/**
 * Cancel a sponsor's package (active or waiting for payment): its allowances end, its sponsored
 * session slots are released and its comp code closes (registration's subscriber). Money paid
 * online is refunded separately (not automatic).
 */
export const cancelSponsorGrantCommand = tenantCommand({
  name: 'program.cancelSponsorGrant',
  input: z.object({ eventId: z.uuid(), grantId: z.uuid() }),
  output: z.object({ cancelled: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const [g] = await tx
      .select()
      .from(sponsorGrants)
      .where(
        and(
          eq(sponsorGrants.id, input.grantId),
          eq(sponsorGrants.eventId, input.eventId),
          inArray(sponsorGrants.status, ['active', 'pending']),
        ),
      )
      .for('update');
    if (!g) throw new DomainError('not_found');
    const [row] = await tx
      .update(sponsorGrants)
      .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
      .where(eq(sponsorGrants.id, g.id))
      .returning();
    if (g.status === 'active') {
      await tx.delete(sponsoredSessions).where(eq(sponsoredSessions.sponsorId, g.sponsorId));
      if (row) emit(packageCancelled(row));
    }
    return { cancelled: true };
  },
  audit: (input) => ({
    action: 'program.sponsor_package.cancel',
    targetType: 'event',
    targetId: input.eventId,
    data: { grantId: input.grantId },
  }),
});

/** Before a sponsor is deleted: its active package is cancelled (the comp code closes). */
export async function cancelSponsorPackagesTx(tx: TenantTx, ctx: Ctx, sponsorId: string, emit: Emit) {
  const rows = await tx
    .update(sponsorGrants)
    .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(sponsorGrants.sponsorId, sponsorId), eq(sponsorGrants.status, 'active')))
    .returning();
  for (const g of rows) emit(packageCancelled(g));
}

/** Which exhibitor a sponsor exhibits as (gets its badges and lead licenses), or none. */
export const setSponsorExhibitorCommand = tenantCommand({
  name: 'program.setSponsorExhibitor',
  input: z.object({ eventId: z.uuid(), sponsorId: z.uuid(), exhibitorId: z.uuid().nullable() }),
  output: z.object({ sponsorId: z.uuid() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await sponsorTx(tx, input.eventId, input.sponsorId, true);
    if (input.exhibitorId) {
      const [x] = await tx
        .select({ id: exhibitors.id })
        .from(exhibitors)
        .where(and(eq(exhibitors.id, input.exhibitorId), eq(exhibitors.eventId, input.eventId)));
      if (!x)
        throw new DomainError('validation_failed', 'Unknown exhibitor', {
          field: 'exhibitorId',
          reason: 'unknown',
        });
      const [taken] = await tx
        .select({ sponsorId: sponsorProfiles.sponsorId })
        .from(sponsorProfiles)
        .where(eq(sponsorProfiles.exhibitorId, input.exhibitorId));
      if (taken && taken.sponsorId !== input.sponsorId)
        throw new DomainError('conflict', 'Another sponsor exhibits as this exhibitor', {
          field: 'exhibitorId',
          reason: 'exhibitor_taken',
        });
    }
    await tx
      .insert(sponsorProfiles)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        sponsorId: input.sponsorId,
        exhibitorId: input.exhibitorId,
      })
      .onConflictDoUpdate({
        target: [sponsorProfiles.orgId, sponsorProfiles.sponsorId],
        set: { exhibitorId: input.exhibitorId, updatedAt: ctx.now },
      });
    return { sponsorId: input.sponsorId };
  },
  audit: (input) => ({
    action: 'program.sponsor.exhibitor',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId, exhibitorId: input.exhibitorId },
  }),
});

const contactStatus = (s: string): SponsorContactDto['status'] =>
  s === 'invited' ? 'pending' : s === 'active' ? 'active' : 'revoked';

/** Invite a sponsor contact (P5-7): a portal account for the sponsor, emailed by the invite mailer. */
export const inviteSponsorContactCommand = tenantCommand({
  name: 'program.inviteSponsorContact',
  input: z.object({ eventId: z.uuid(), sponsorId: z.uuid(), email: Email }),
  output: z.object({ contact: SponsorContactDto, sponsorName: z.string() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const sponsor = await sponsorTx(tx, input.eventId, input.sponsorId, true);
    const mine = (await portalAccountsTx(tx, input.eventId, 'sponsor', ctx.now)).filter(
      (a) => a.subjectId === sponsor.id && (a.status === 'invited' || a.status === 'active'),
    );
    if (mine.some((a) => a.email === input.email))
      throw new DomainError('conflict', 'Already invited', { field: 'email', reason: 'already_invited' });
    if (mine.length >= MAX_CONTACTS_PER_SPONSOR)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const r = await createPortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      role: 'sponsor_contact',
      subjectId: sponsor.id,
      email: input.email,
    });
    emit(r.event);
    return {
      contact: SponsorContactDto.parse({ ...r.account, status: contactStatus(r.account.status) }),
      sponsorName: sponsor.name,
    };
  },
  audit: (input, r) => ({
    action: 'program.sponsor_contact.invite',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId, accountId: r?.contact.id },
  }),
});

async function contactTx(tx: TenantTx, ctx: Ctx, eventId: string, accountId: string) {
  const a = (await portalAccountsTx(tx, eventId, 'sponsor', ctx.now)).find((x) => x.id === accountId);
  if (!a || a.status === 'revoked' || a.status === 'expired') throw new DomainError('not_found');
  return a;
}

/** A fresh invitation (a new version: the old link stops working). */
export const resendSponsorInviteCommand = tenantCommand({
  name: 'program.resendSponsorInvite',
  input: z.object({ eventId: z.uuid(), accountId: z.uuid() }),
  output: z.object({ resent: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const a = await contactTx(tx, ctx, input.eventId, input.accountId);
    const r = await createPortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      role: 'sponsor_contact',
      subjectId: a.subjectId,
      email: a.email,
    });
    emit(r.event);
    return { resent: true };
  },
  audit: (input) => ({
    action: 'program.sponsor_contact.resend',
    targetType: 'event',
    targetId: input.eventId,
    data: { accountId: input.accountId },
  }),
});

export const revokeSponsorContactCommand = tenantCommand({
  name: 'program.revokeSponsorContact',
  input: z.object({ eventId: z.uuid(), accountId: z.uuid() }),
  output: z.object({ revoked: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await contactTx(tx, ctx, input.eventId, input.accountId);
    await revokePortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      accountId: input.accountId,
      subjectKind: 'sponsor',
    });
    return { revoked: true };
  },
  audit: (input) => ({
    action: 'program.sponsor_contact.revoke',
    targetType: 'event',
    targetId: input.eventId,
    data: { accountId: input.accountId },
  }),
});

/** Before a sponsor is deleted: revoke its contacts' portal accounts. */
export async function endSponsorContactsTx(tx: TenantTx, ctx: Ctx, eventId: string, sponsorId: string) {
  for (const a of await portalAccountsTx(tx, eventId, 'sponsor', ctx.now))
    if (a.subjectId === sponsorId && (a.status === 'invited' || a.status === 'active'))
      await revokePortalAccountTx(tx, ctx, { eventId, accountId: a.id, subjectKind: 'sponsor' });
}

/** Give a sponsor a session slot: the session shows as sponsored (up to the package's slots). */
export const assignSponsoredSessionCommand = tenantCommand({
  name: 'program.assignSponsoredSession',
  input: z.object({ eventId: z.uuid(), sponsorId: z.uuid(), sessionId: z.uuid() }),
  output: z.object({ used: z.int(), slots: z.int() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await sponsorTx(tx, input.eventId, input.sponsorId, true);
    const [g] = await tx
      .select()
      .from(sponsorGrants)
      .where(and(eq(sponsorGrants.sponsorId, input.sponsorId), eq(sponsorGrants.status, 'active')));
    if (!g || g.sessionSlots === 0)
      throw new DomainError('invalid_state', 'The sponsor’s package has no session slot', {
        reason: 'no_slot',
      });
    const [s] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.eventId, input.eventId)));
    if (!s)
      throw new DomainError('validation_failed', 'Unknown session', { field: 'sessionId', reason: 'unknown' });
    const [taken] = await tx
      .select()
      .from(sponsoredSessions)
      .where(eq(sponsoredSessions.sessionId, input.sessionId));
    if (taken)
      throw new DomainError('conflict', 'This session is already sponsored', {
        field: 'sessionId',
        reason: 'session_taken',
      });
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sponsoredSessions)
      .where(eq(sponsoredSessions.sponsorId, input.sponsorId));
    if (n >= g.sessionSlots)
      throw new DomainError('invalid_state', 'Every session slot is used', {
        reason: 'slots_used',
        slots: g.sessionSlots,
      });
    await tx.insert(sponsoredSessions).values({
      orgId: requireOrg(ctx),
      eventId: input.eventId,
      sponsorId: input.sponsorId,
      sessionId: input.sessionId,
    });
    return { used: n + 1, slots: g.sessionSlots };
  },
  audit: (input) => ({
    action: 'program.sponsored_session.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId, sessionId: input.sessionId },
  }),
});

export const unassignSponsoredSessionCommand = tenantCommand({
  name: 'program.unassignSponsoredSession',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(sponsoredSessions)
      .where(
        and(eq(sponsoredSessions.sessionId, input.sessionId), eq(sponsoredSessions.eventId, input.eventId)),
      )
      .returning({ id: sponsoredSessions.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { removed: true };
  },
  audit: (input) => ({
    action: 'program.sponsored_session.unassign',
    targetType: 'event',
    targetId: input.eventId,
    data: { sessionId: input.sessionId },
  }),
});

/** The tiers of an event with their terms, holders and places left. */
export async function packagesOfTx(tx: TenantTx, eventId: string, now: Date): Promise<SponsorPackageDto[]> {
  const tiers = await tx
    .select()
    .from(sponsorTiers)
    .where(eq(sponsorTiers.eventId, eventId))
    .orderBy(asc(sponsorTiers.position), asc(sponsorTiers.name));
  const terms = await tx.select().from(sponsorPackages).where(eq(sponsorPackages.eventId, eventId));
  const grants = await tx
    .select({ tierId: sponsorGrants.tierId, status: sponsorGrants.status, holdUntil: sponsorGrants.holdUntil })
    .from(sponsorGrants)
    .where(eq(sponsorGrants.eventId, eventId));
  return tiers.map((t) => {
    const p = terms.find((x) => x.tierId === t.id) ?? null;
    const mine = grants.filter((g) => g.tierId === t.id);
    return {
      tierId: t.id,
      name: t.name,
      position: t.position,
      terms: p
        ? {
            description: p.description,
            priceMinor: p.priceMinor,
            currency: p.currency,
            quantity: p.quantity,
            onSale: p.onSale,
            allowances: allowancesOf(p),
            deliverables: templatesOf(p.deliverables),
          }
        : null,
      holders: mine.filter((g) => g.status === 'active').length,
      left: p ? packagesLeft(p.quantity, mine, now) : null,
    };
  });
}

/** The organizer's sponsorship page: packages, and per sponsor its package, contacts and sessions. */
export const sponsorshipAdminQuery = tenantQuery({
  name: 'program.sponsorshipAdmin',
  input: z.object({ eventId: z.uuid() }),
  output: SponsorshipAdminDto,
  entitlement: 'sponsors',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await eventOf(tx, input.eventId);
    const packages = await packagesOfTx(tx, input.eventId, ctx.now);
    const tierName = new Map(packages.map((p) => [p.tierId, p.name]));
    const list = await tx
      .select()
      .from(sponsors)
      .where(eq(sponsors.eventId, input.eventId))
      .orderBy(asc(sponsors.name), asc(sponsors.createdAt));
    const grants = await tx
      .select()
      .from(sponsorGrants)
      .where(
        and(eq(sponsorGrants.eventId, input.eventId), inArray(sponsorGrants.status, ['active', 'pending'])),
      );
    const profiles = await tx.select().from(sponsorProfiles).where(eq(sponsorProfiles.eventId, input.eventId));
    const xs = await tx
      .select({ id: exhibitors.id, name: exhibitors.name })
      .from(exhibitors)
      .where(eq(exhibitors.eventId, input.eventId))
      .orderBy(asc(exhibitors.name));
    const allSessions = await tx
      .select({ id: sessions.id, title: sessions.title, sponsorId: sponsoredSessions.sponsorId })
      .from(sessions)
      .leftJoin(sponsoredSessions, eq(sponsoredSessions.sessionId, sessions.id))
      .where(eq(sessions.eventId, input.eventId))
      .orderBy(asc(sessions.startsAt), asc(sessions.title));
    const contacts = await portalAccountsTx(tx, input.eventId, 'sponsor', ctx.now);
    const deliverables = await tx
      .select({ sponsorId: sponsorDeliverables.sponsorId, status: sponsorDeliverables.status, dueAt: sponsorDeliverables.dueAt })
      .from(sponsorDeliverables)
      .where(eq(sponsorDeliverables.eventId, input.eventId));
    return {
      timezone: event.timezone,
      currency: event.currency,
      packages,
      sponsors: list.map((s) => {
        const active = grants.find((g) => g.sponsorId === s.id && g.status === 'active');
        const pending = grants.find(
          (g) => g.sponsorId === s.id && g.status === 'pending' && g.holdUntil && g.holdUntil > ctx.now,
        );
        const exhibitorId = profiles.find((p) => p.sponsorId === s.id)?.exhibitorId ?? null;
        const mine = deliverables.filter((d) => d.sponsorId === s.id);
        return {
          id: s.id,
          name: s.name,
          tierId: s.tierId,
          tierName: tierName.get(s.tierId) ?? '',
          exhibitorId,
          exhibitorName: xs.find((x) => x.id === exhibitorId)?.name ?? null,
          grant: active ? grantDto(active, tierName.get(active.tierId) ?? '') : null,
          pendingUntil: pending?.holdUntil ?? null,
          contacts: contacts
            .filter((a) => a.subjectId === s.id && (a.status === 'invited' || a.status === 'active'))
            .map((a) => SponsorContactDto.parse({ ...a, status: contactStatus(a.status) })),
          sessions: allSessions
            .filter((x) => x.sponsorId === s.id)
            .map((x) => ({ id: x.id, title: x.title })),
          deliverables: {
            open: mine.filter((d) => d.status === 'open').length,
            done: mine.filter((d) => d.status === 'done').length,
            overdue: mine.filter((d) => isOverdue(d, ctx.now)).length,
          },
        };
      }),
      exhibitors: xs,
      sessions: allSessions,
    };
  },
});

/* ------------------------------------------------- add-on purchase (orders calls) ---- */

/**
 * A sponsor contact starts buying a package (orders' `startSponsorPackageCheckout` calls this in
 * its transaction): the sponsor row and the package are locked, the package must be on sale with
 * a place left, and the sponsor must hold none and have none waiting. A pending grant holds the
 * place for `PURCHASE_HOLD_MINUTES` (the order's hold plus its payment extension).
 */
export async function reserveSponsorPackageTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { tierId: string },
): Promise<AddonOfferDto> {
  const { principal, sponsor } = await sponsorPrincipalTx(tx, ctx, true);
  const tier = await tierTx(tx, principal.eventId, input.tierId);
  const pkg = await packageTx(tx, principal.eventId, input.tierId, true).catch(() => null);
  if (!pkg?.onSale || pkg.priceMinor === null) throw new DomainError('not_found', 'Package not found');
  const { active, pending } = await currentGrantsTx(tx, sponsor.id, ctx.now);
  if (active)
    throw new DomainError('conflict', 'You already hold a package', { reason: 'already_granted' });
  if (pending)
    throw new DomainError('invalid_state', 'A purchase is waiting for payment', {
      reason: 'purchase_pending',
    });
  if ((await leftOfTx(tx, pkg, ctx.now)) === 0)
    throw new DomainError('invalid_state', 'This package is sold out', { reason: 'sold_out' });
  const [g] = await tx
    .insert(sponsorGrants)
    .values({
      orgId: requireOrg(ctx),
      eventId: principal.eventId,
      sponsorId: sponsor.id,
      tierId: tier.id,
      status: 'pending',
      source: 'purchase',
      holdUntil: new Date(ctx.now.getTime() + PURCHASE_HOLD_MINUTES * 60_000),
      priceMinor: pkg.priceMinor,
      currency: pkg.currency,
      ...allowancesOf(pkg),
      grantedBy: actorId(ctx.actor),
    })
    .returning();
  if (!g) throw new DomainError('internal');
  return {
    refId: g.id,
    eventId: principal.eventId,
    name: tier.name,
    quantity: 1,
    unitFaceMinor: pkg.priceMinor,
    currency: pkg.currency,
    buyer: { email: principal.email, name: sponsor.name },
  };
}

/** The order that pays for a pending grant. */
export async function attachGrantOrderTx(tx: TenantTx, grantId: string, orderId: string) {
  await tx.update(sponsorGrants).set({ orderId }).where(eq(sponsorGrants.id, grantId));
}

/**
 * A verified payment of a package's order (orders' `applyProviderEvent`, same transaction):
 * activates the pending grant with exactly the allowances it snapshotted. A payment after the hold
 * lapsed still activates it while the sponsor holds no other package and a place is left;
 * otherwise `unavailable` (orders flags the payment for refund).
 */
export async function activatePurchasedGrantTx(
  tx: TenantTx,
  ctx: Ctx,
  grantId: string,
  emit: Emit,
): Promise<'activated' | 'already' | 'unavailable'> {
  const [g] = await tx.select().from(sponsorGrants).where(eq(sponsorGrants.id, grantId)).for('update');
  if (!g) return 'unavailable';
  if (g.status === 'active') return 'already';
  const event = await eventOf(tx, g.eventId);
  await sponsorTx(tx, g.eventId, g.sponsorId, true).catch(() => null);
  const [other] = await tx
    .select({ id: sponsorGrants.id })
    .from(sponsorGrants)
    .where(and(eq(sponsorGrants.sponsorId, g.sponsorId), eq(sponsorGrants.status, 'active')));
  const pkg = await packageTx(tx, g.eventId, g.tierId, true).catch(() => null);
  if (other || !pkg || (await leftOfTx(tx, pkg, ctx.now, g.id)) === 0) {
    if (g.status === 'pending')
      await tx
        .update(sponsorGrants)
        .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
        .where(eq(sponsorGrants.id, g.id));
    return 'unavailable';
  }
  const [row] = await tx
    .update(sponsorGrants)
    .set({ status: 'active', activatedAt: ctx.now, holdUntil: null, cancelledAt: null, updatedAt: ctx.now })
    .where(eq(sponsorGrants.id, g.id))
    .returning();
  if (!row) throw new DomainError('internal');
  await activateEffectsTx(tx, ctx, row, event, emit);
  return 'activated';
}

/**
 * Registration's comp-code subscriber records the code it made for an active grant (once): the
 * sponsor contact shares it with their guests.
 */
export async function attachCompCodeTx(
  tx: TenantTx,
  grantId: string,
  code: { promoCodeId: string; code: string },
): Promise<boolean> {
  const rows = await tx
    .update(sponsorGrants)
    .set({ compCode: code.code, compPromoCodeId: code.promoCodeId })
    .where(
      and(eq(sponsorGrants.id, grantId), eq(sponsorGrants.status, 'active'), sql`comp_code is null`),
    )
    .returning({ id: sponsorGrants.id });
  return rows.length > 0;
}

/** A grant's comp code state (the subscriber checks it before making a code). */
export async function grantCompStateTx(tx: TenantTx, grantId: string) {
  const [g] = await tx
    .select({
      status: sponsorGrants.status,
      eventId: sponsorGrants.eventId,
      compRegistrations: sponsorGrants.compRegistrations,
      compCode: sponsorGrants.compCode,
      compPromoCodeId: sponsorGrants.compPromoCodeId,
    })
    .from(sponsorGrants)
    .where(eq(sponsorGrants.id, grantId));
  return g ?? null;
}

/** A sponsor's active grant's comp code state (registration's usage query). */
export async function activeGrantOfSponsorTx(tx: TenantTx, sponsorId: string) {
  const [g] = await tx
    .select({
      compRegistrations: sponsorGrants.compRegistrations,
      compCode: sponsorGrants.compCode,
      compPromoCodeId: sponsorGrants.compPromoCodeId,
    })
    .from(sponsorGrants)
    .where(and(eq(sponsorGrants.sponsorId, sponsorId), eq(sponsorGrants.status, 'active')));
  return g ?? null;
}
