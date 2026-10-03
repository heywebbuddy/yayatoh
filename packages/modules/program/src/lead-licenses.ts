import { ensureEventAddonTx } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { portalAccountsTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { staffAllowance } from './domain/exhibitors.ts';
import {
  DEFAULT_INCLUDED_LEAD_LICENSES,
  leadLicenseAllowance,
  PURCHASE_HOLD_MINUTES,
  seatUse,
} from './domain/sponsorship.ts';
import { exhibitorPrincipalTx, exhibitorSettingsTx } from './exhibitor-portal.ts';
import { exhibitorProfiles, exhibitorSettings, exhibitors } from './schema.ts';
import { leadLicensePurchases, leadLicenses } from './schema-sponsors.ts';
import { eventOf } from './shared.ts';
import { packageBadgesTx, packageLicensesTx } from './sponsor-allowances.ts';
import {
  type AddonOfferDto,
  type LeadLicenseSettingsDto,
  LeadLicensesAdminDto,
  type LeadLicenseUseDto,
  PortalLeadLicensesDto,
  portalLeadLicensesSerializer,
} from './sponsor-dto.ts';

/**
 * M5.4b lead licenses (P5-4), in program's exhibitors area. A license is one named scanning seat
 * held by one of the exhibitor's portal accounts and reassigned by the exhibitor admin. Each
 * exhibitor gets the event's included licenses (1 unless the organizer says), plus those of the
 * active packages of the sponsor that exhibits as it, plus extra licenses its admin buys (the
 * organizer's add-on, paid through an add-on order). Seats are counted under the exhibitor's row
 * lock, so concurrent assignments stop exactly at the allowance. Using licenses activates the
 * `lead_retrieval` event add-on (free in beta, priced later with no code change).
 */
export const MAX_PURCHASED_LICENSES = 100;

export async function leadLicenseSettingsTx(tx: TenantTx, eventId: string): Promise<LeadLicenseSettingsDto> {
  const event = await eventOf(tx, eventId);
  const [row] = await tx.select().from(exhibitorSettings).where(eq(exhibitorSettings.eventId, eventId));
  return {
    includedLeadLicenses: row?.includedLeadLicenses ?? DEFAULT_INCLUDED_LEAD_LICENSES,
    leadLicensePriceMinor: row?.leadLicensePriceMinor ?? null,
    currency: event.currency,
  };
}

/** Live portal accounts of an exhibitor (invited or signed in): who may hold a seat. */
async function livePeopleTx(tx: TenantTx, ctx: Ctx, eventId: string, exhibitorId: string) {
  return (await portalAccountsTx(tx, eventId, 'exhibitor', ctx.now)).filter(
    (a) => a.subjectId === exhibitorId && (a.status === 'invited' || a.status === 'active'),
  );
}

/** Seats of an exhibitor whose account is still live (revoked people's seats free themselves). */
async function seatsTx(tx: TenantTx, ctx: Ctx, eventId: string, exhibitorId: string) {
  const live = new Set((await livePeopleTx(tx, ctx, eventId, exhibitorId)).map((a) => a.id));
  const rows = await tx.select().from(leadLicenses).where(eq(leadLicenses.exhibitorId, exhibitorId));
  return { live, seats: rows.filter((r) => live.has(r.accountId)), stale: rows.filter((r) => !live.has(r.accountId)) };
}

async function purchasedTx(tx: TenantTx, exhibitorId: string) {
  return (
    await tx
      .select({ quantity: leadLicensePurchases.quantity })
      .from(leadLicensePurchases)
      .where(and(eq(leadLicensePurchases.exhibitorId, exhibitorId), eq(leadLicensePurchases.status, 'active')))
  ).map((r) => r.quantity);
}

/** An exhibitor's licenses: included + packages + purchased, and seats used. */
export async function leadLicenseUseTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  exhibitorId: string,
): Promise<LeadLicenseUseDto> {
  const settings = await leadLicenseSettingsTx(tx, eventId);
  const fromPackages = await packageLicensesTx(tx, exhibitorId);
  const purchased = await purchasedTx(tx, exhibitorId);
  const allowance = leadLicenseAllowance({ included: settings.includedLeadLicenses, fromPackages, purchased });
  const { seats } = await seatsTx(tx, ctx, eventId, exhibitorId);
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  return {
    included: settings.includedLeadLicenses,
    fromPackages: sum(fromPackages),
    purchased: sum(purchased),
    ...seatUse(allowance, seats.length),
  };
}

/* ------------------------------------------------------------------ organizer side ---- */

export const saveLeadLicenseSettingsCommand = tenantCommand({
  name: 'program.saveLeadLicenseSettings',
  input: z.object({
    eventId: z.uuid(),
    includedLeadLicenses: z.int().min(0).max(50),
    leadLicensePriceMinor: z.int().min(1).max(100_000_000).nullable(),
  }),
  output: z.object({ eventId: z.uuid() }),
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
    return { eventId };
  },
  audit: (input) => ({
    action: 'program.lead_license_settings.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { included: input.includedLeadLicenses, priceMinor: input.leadLicensePriceMinor },
  }),
});

/** Per exhibitor: licenses (included, packages, purchased, used) and staff badges (base, packages). */
export const leadLicensesAdminQuery = tenantQuery({
  name: 'program.leadLicensesAdmin',
  input: z.object({ eventId: z.uuid() }),
  output: LeadLicensesAdminDto,
  entitlement: 'exhibitors',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const settings = await leadLicenseSettingsTx(tx, input.eventId);
    const staff = await exhibitorSettingsTx(tx, input.eventId);
    const list = await tx
      .select({ id: exhibitors.id, name: exhibitors.name, own: exhibitorProfiles.staffAllowance })
      .from(exhibitors)
      .leftJoin(exhibitorProfiles, eq(exhibitorProfiles.exhibitorId, exhibitors.id))
      .where(eq(exhibitors.eventId, input.eventId))
      .orderBy(asc(exhibitors.name), asc(exhibitors.createdAt));
    const out: LeadLicensesAdminDto['exhibitors'] = [];
    for (const x of list)
      out.push({
        exhibitorId: x.id,
        name: x.name,
        licenses: await leadLicenseUseTx(tx, ctx, input.eventId, x.id),
        staffBadges: {
          base: staffAllowance(staff.defaultStaffAllowance, x.own),
          fromPackages: (await packageBadgesTx(tx, x.id)).reduce((n, b) => n + b, 0),
        },
      });
    return { settings, exhibitors: out };
  },
});

/* ---------------------------------------------------------------------- portal side ---- */

/** What the signed-in exhibitor person sees of their licenses (staff: only their own seat). */
export const portalLeadLicensesQuery = tenantQuery({
  name: 'program.portalLeadLicenses',
  input: z.object({}),
  output: PortalLeadLicensesDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor',
  handler: async ({ ctx, tx }) => {
    const { principal: me, exhibitor } = await exhibitorPrincipalTx(tx, ctx);
    const settings = await leadLicenseSettingsTx(tx, me.eventId);
    const people = await livePeopleTx(tx, ctx, me.eventId, exhibitor.id);
    const { seats } = await seatsTx(tx, ctx, me.eventId, exhibitor.id);
    const licensed = new Set(seats.map((s) => s.accountId));
    const admin = me.role === 'exhibitor_admin';
    const [pending] = await tx
      .select({ holdUntil: leadLicensePurchases.holdUntil })
      .from(leadLicensePurchases)
      .where(
        and(
          eq(leadLicensePurchases.exhibitorId, exhibitor.id),
          eq(leadLicensePurchases.status, 'pending'),
          sql`hold_until > ${ctx.now}`,
        ),
      );
    return portalLeadLicensesSerializer.serialize({
      role: me.role,
      licenses: await leadLicenseUseTx(tx, ctx, me.eventId, exhibitor.id),
      people: people
        .filter((a) => admin || a.id === me.accountId)
        .map((a) => ({ accountId: a.id, email: a.email, role: a.role, licensed: licensed.has(a.id) })),
      price:
        admin && settings.leadLicensePriceMinor !== null
          ? { unitMinor: settings.leadLicensePriceMinor, currency: settings.currency }
          : null,
      pendingUntil: admin ? (pending?.holdUntil ?? null) : null,
      mine: licensed.has(me.accountId),
    });
  },
});

/** The exhibitor admin gives one of their people a license (up to the allowance). */
export const portalAssignLeadLicenseCommand = tenantCommand({
  name: 'program.portalAssignLeadLicense',
  input: z.object({ accountId: z.uuid() }),
  output: z.object({ used: z.int(), allowance: z.int(), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx }) => {
    const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
    await tx.select({ id: exhibitors.id }).from(exhibitors).where(eq(exhibitors.id, exhibitor.id)).for('update');
    const { live, seats, stale } = await seatsTx(tx, ctx, principal.eventId, exhibitor.id);
    // Another exhibitor's people, revoked people and unknown ids look the same.
    if (!live.has(input.accountId)) throw new DomainError('not_found');
    if (seats.some((s) => s.accountId === input.accountId))
      throw new DomainError('conflict', 'Already licensed', { reason: 'already_licensed' });
    const use = await leadLicenseUseTx(tx, ctx, principal.eventId, exhibitor.id);
    if (use.left <= 0)
      throw new DomainError('invalid_state', 'Every lead license is in use', {
        reason: 'licenses_used',
        allowance: use.allowance,
      });
    // P5-4: lead retrieval is an event add-on (free in beta) with an event-wide quota.
    const addon = await ensureEventAddonTx(tx, ctx, principal.eventId, 'lead_retrieval');
    const quota = addon.quotas.leadLicenses;
    if (quota !== undefined) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(leadLicenses)
        .where(eq(leadLicenses.eventId, principal.eventId));
      if (n >= quota) throw new DomainError('invalid_state', 'Limit reached', { reason: 'quota_reached' });
    }
    if (stale.length)
      await tx.delete(leadLicenses).where(
        inArray(
          leadLicenses.id,
          stale.map((s) => s.id),
        ),
      );
    await tx.insert(leadLicenses).values({
      orgId: requireOrg(ctx),
      eventId: principal.eventId,
      exhibitorId: exhibitor.id,
      accountId: input.accountId,
    });
    return { used: use.used + 1, allowance: use.allowance, exhibitorId: exhibitor.id };
  },
  audit: (input, r) => ({
    action: 'program.lead_license.assign',
    targetType: 'program_exhibitor',
    targetId: r?.exhibitorId ?? null,
    data: { accountId: input.accountId },
  }),
});

/** The exhibitor admin takes a license back (to give it to someone else). */
export const portalReleaseLeadLicenseCommand = tenantCommand({
  name: 'program.portalReleaseLeadLicense',
  input: z.object({ accountId: z.uuid() }),
  output: z.object({ released: z.boolean(), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx }) => {
    const { exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
    const rows = await tx
      .delete(leadLicenses)
      .where(and(eq(leadLicenses.exhibitorId, exhibitor.id), eq(leadLicenses.accountId, input.accountId)))
      .returning({ id: leadLicenses.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { released: true, exhibitorId: exhibitor.id };
  },
  audit: (input, r) => ({
    action: 'program.lead_license.release',
    targetType: 'program_exhibitor',
    targetId: r?.exhibitorId ?? null,
    data: { accountId: input.accountId },
  }),
});

/* ------------------------------------------------- add-on purchase (orders calls) ---- */

/**
 * An exhibitor admin starts buying extra licenses (orders' `startLeadLicenseCheckout` calls this
 * in its transaction): the organizer must sell them, one purchase waits at a time, and an
 * exhibitor buys at most `MAX_PURCHASED_LICENSES` in all.
 */
export async function reserveLeadLicensesTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { quantity: number },
): Promise<AddonOfferDto> {
  const { principal, exhibitor } = await exhibitorPrincipalTx(tx, ctx, 'admin');
  await tx.select({ id: exhibitors.id }).from(exhibitors).where(eq(exhibitors.id, exhibitor.id)).for('update');
  const settings = await leadLicenseSettingsTx(tx, principal.eventId);
  if (settings.leadLicensePriceMinor === null)
    throw new DomainError('invalid_state', 'Extra lead licenses are not for sale', { reason: 'not_for_sale' });
  const [live] = await tx
    .select({ id: leadLicensePurchases.id })
    .from(leadLicensePurchases)
    .where(
      and(
        eq(leadLicensePurchases.exhibitorId, exhibitor.id),
        eq(leadLicensePurchases.status, 'pending'),
        sql`hold_until > ${ctx.now}`,
      ),
    );
  if (live)
    throw new DomainError('invalid_state', 'A purchase is waiting for payment', { reason: 'purchase_pending' });
  const bought = (await purchasedTx(tx, exhibitor.id)).reduce((n, q) => n + q, 0);
  if (bought + input.quantity > MAX_PURCHASED_LICENSES)
    throw new DomainError('validation_failed', 'Too many licenses', {
      field: 'quantity',
      reason: 'too_many',
      max: MAX_PURCHASED_LICENSES - bought,
    });
  const [p] = await tx
    .insert(leadLicensePurchases)
    .values({
      orgId: requireOrg(ctx),
      eventId: principal.eventId,
      exhibitorId: exhibitor.id,
      quantity: input.quantity,
      unitPriceMinor: settings.leadLicensePriceMinor,
      currency: settings.currency,
      status: 'pending',
      holdUntil: new Date(ctx.now.getTime() + PURCHASE_HOLD_MINUTES * 60_000),
    })
    .returning();
  if (!p) throw new DomainError('internal');
  return {
    refId: p.id,
    eventId: principal.eventId,
    name: 'Lead licenses',
    quantity: input.quantity,
    unitFaceMinor: settings.leadLicensePriceMinor,
    currency: settings.currency,
    buyer: { email: principal.email, name: exhibitor.name },
  };
}

export async function attachLicenseOrderTx(tx: TenantTx, purchaseId: string, orderId: string) {
  await tx.update(leadLicensePurchases).set({ orderId }).where(eq(leadLicensePurchases.id, purchaseId));
}

/**
 * A verified payment of a license order (orders' `applyProviderEvent`, same transaction): the
 * licenses are added. Licenses have no stock, so a payment after the hold lapsed still counts.
 */
export async function activateLicensePurchaseTx(
  tx: TenantTx,
  ctx: Ctx,
  purchaseId: string,
): Promise<'activated' | 'already' | 'unavailable'> {
  const [p] = await tx
    .select()
    .from(leadLicensePurchases)
    .where(eq(leadLicensePurchases.id, purchaseId))
    .for('update');
  if (!p) return 'unavailable';
  if (p.status === 'active') return 'already';
  await tx
    .update(leadLicensePurchases)
    .set({ status: 'active', activatedAt: ctx.now, holdUntil: null, updatedAt: ctx.now })
    .where(eq(leadLicensePurchases.id, p.id));
  return 'activated';
}

