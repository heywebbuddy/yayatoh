import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agencyV2Enabled } from './provider/flag.ts';
import { AGENCY_BILLING_END_REASONS, agencyBilling, agencyBillingOffers } from './schema.ts';

/**
 * Agency v2 money, part 1 (M6.8a, P6-8, flag `agency_v2` = `AGENCY_V2_ENABLED`): **the agency pays
 * for clients.** An agency org with the `agency` entitlement offers to pay a client's plan; the
 * client (owner or admin)
 * accepts. While that holds (the client's grant to the agency is live, the offer stands, the agency
 * still has the flag and is not read-only for an unpaid subscription), the agency's plan covers the
 * client (`billing.agency_cover_modules`, added to the client's effective modules) and the agency
 * earns `commission_bps` of the organizer's share of each `platform_mor` sale as a second transfer
 * at release (payments). Either side ends it at any time; revoking the grant ends it too.
 *
 * Cross-org reads go only through SECURITY DEFINER functions (hand-written in the migration):
 * `billing.agency_offers_for_me()`, `billing.agency_billing_active()`, `billing.agency_client_live()`
 * and `billing.agency_billed_clients()`, the org always from the transaction.
 */

/**
 * The commission rate a new agency billing starts with: 10 % of the organizer's share. A
 * **placeholder pending the owner** (P6-8, "commission defaults are yours"); staff change one
 * client's rate with `billing.setAgencyCommission`.
 */
export const DEFAULT_AGENCY_COMMISSION_BPS = 1000;

export type AgencyBillingEndReason = (typeof AGENCY_BILLING_END_REASONS)[number];

/** The agency billing in force for the current (client) org, or null. */
export interface AgencyBillingInForce {
  readonly billingId: string;
  readonly agencyOrgId: string;
  readonly grantId: string;
  readonly commissionBps: number;
}

export async function agencyBillingActiveTx(tx: TenantTx): Promise<AgencyBillingInForce | null> {
  if (!agencyV2Enabled()) return null;
  const [r] = await tx.execute<{
    billing_id: string;
    agency_org_id: string;
    grant_id: string;
    commission_bps: number;
  }>(sql`select billing_id, agency_org_id, grant_id, commission_bps from billing.agency_billing_active()`);
  return r
    ? {
        billingId: r.billing_id,
        agencyOrgId: r.agency_org_id,
        grantId: r.grant_id,
        commissionBps: Number(r.commission_bps),
      }
    : null;
}

const userOf = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

// --- The agency's side -------------------------------------------------------------------------

/** The refusal while the `agency_v2` flag is off. */
function requireAgencyV2() {
  if (!agencyV2Enabled())
    throw new DomainError('module_not_enabled', 'Agency billing is not available yet', {
      module: 'agency_v2',
    });
}

/** Offer to pay a client's plan (the agency, owner or admin; flag `agency_v2`). */
export const offerAgencyBillingCommand = tenantCommand({
  name: 'billing.offerAgencyBilling',
  category: 'money',
  input: z.object({ clientOrgId: z.uuid() }),
  output: z.object({ offerId: z.uuid(), created: z.boolean() }),
  entitlement: 'agency',
  permission: 'billing:manage',
  // A standing promise to pay another org's plan, like a plan change.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    requireAgencyV2();
    const orgId = requireOrg(ctx);
    const [live] = await tx.execute<{ ok: boolean }>(
      sql`select billing.agency_client_live(${input.clientOrgId}) as ok`,
    );
    if (!live?.ok) throw new DomainError('not_found', 'This client has not given your agency access');
    const [existing] = await tx
      .select({ id: agencyBillingOffers.id })
      .from(agencyBillingOffers)
      .where(
        and(eq(agencyBillingOffers.clientOrgId, input.clientOrgId), isNull(agencyBillingOffers.withdrawnAt)),
      );
    if (existing) return { offerId: existing.id, created: false };
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(agencyBillingOffers)
        .values({ orgId, clientOrgId: input.clientOrgId, offeredBy: userOf(ctx) })
        .returning({ id: agencyBillingOffers.id });
    } catch (err) {
      if (isUniqueViolation(err, 'agency_billing_offers_org_client_live_key'))
        throw new DomainError('conflict', 'You already offered to pay this client’s plan');
      throw err;
    }
    if (!row) throw new DomainError('internal');
    emit({
      type: 'billing.agency_billing_offered',
      version: 1,
      aggregateType: 'organization',
      aggregateId: input.clientOrgId,
      payload: { orgId, agencyOrgId: orgId, clientOrgId: input.clientOrgId },
    });
    return { offerId: row.id, created: true };
  },
  audit: (input, r) => ({
    action: 'agencyBilling.offer',
    targetType: 'organization',
    targetId: input.clientOrgId,
    data: { kind: 'agency_billing', status: r?.created ? 'offered' : 'unchanged' },
  }),
});

/** Withdraw an offer: an agency billing it backed ends (the client pays for itself again). */
export const withdrawAgencyBillingOfferCommand = tenantCommand({
  name: 'billing.withdrawAgencyBillingOffer',
  category: 'money',
  input: z.object({ clientOrgId: z.uuid() }),
  output: z.object({ withdrawn: z.boolean() }),
  // Stopping must work after the flag is switched off.
  entitlement: null,
  permission: 'billing:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const rows = await tx
      .update(agencyBillingOffers)
      .set({ withdrawnAt: ctx.now, withdrawnBy: userOf(ctx), updatedAt: ctx.now })
      .where(
        and(eq(agencyBillingOffers.clientOrgId, input.clientOrgId), isNull(agencyBillingOffers.withdrawnAt)),
      )
      .returning({ id: agencyBillingOffers.id });
    if (rows.length === 0) return { withdrawn: false };
    emit({
      type: 'billing.agency_billing_withdrawn',
      version: 1,
      aggregateType: 'organization',
      aggregateId: input.clientOrgId,
      payload: { orgId, agencyOrgId: orgId, clientOrgId: input.clientOrgId },
    });
    return { withdrawn: true };
  },
  audit: (input, r) => ({
    action: 'agencyBilling.withdraw',
    targetType: 'organization',
    targetId: input.clientOrgId,
    data: { kind: 'agency_billing', status: r?.withdrawn ? 'withdrawn' : 'unchanged' },
  }),
});

export const AgencyBilledClientDto = z.object({
  clientOrgId: z.uuid(),
  /** The agency's live offer to this client (null: none). */
  offeredAt: z.date().nullable(),
  /** The client's acceptance (null: not accepted, or ended). */
  acceptedAt: z.date().nullable(),
  commissionBps: z.int().nullable(),
});
export type AgencyBilledClientDto = z.infer<typeof AgencyBilledClientDto>;

/**
 * The agency's billing view, per client it offered to or that accepted: live offer, live
 * acceptance and rate. Client names come from the agency's own snapshots (the page joins them).
 */
export const agencyBilledClientsQuery = tenantQuery({
  name: 'billing.agencyBilledClients',
  input: z.object({}),
  output: z.array(AgencyBilledClientDto),
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ tx }) => {
    const offers = await tx
      .select({ clientOrgId: agencyBillingOffers.clientOrgId, at: agencyBillingOffers.createdAt })
      .from(agencyBillingOffers)
      .where(isNull(agencyBillingOffers.withdrawnAt));
    const accepted = await tx.execute<{
      client_org_id: string;
      commission_bps: number;
      accepted_at: Date;
      ended_at: Date | null;
    }>(sql`select client_org_id, commission_bps, accepted_at, ended_at from billing.agency_billed_clients()`);
    const out = new Map<string, AgencyBilledClientDto>();
    for (const o of offers)
      out.set(o.clientOrgId, {
        clientOrgId: o.clientOrgId,
        offeredAt: o.at,
        acceptedAt: null,
        commissionBps: null,
      });
    for (const a of accepted) {
      if (a.ended_at) continue;
      const prev = out.get(a.client_org_id);
      out.set(a.client_org_id, {
        clientOrgId: a.client_org_id,
        offeredAt: prev?.offeredAt ?? null,
        acceptedAt: new Date(a.accepted_at),
        commissionBps: Number(a.commission_bps),
      });
    }
    return [...out.values()];
  },
});

// --- The client's side -------------------------------------------------------------------------

export const AgencyBillingRowDto = z.object({
  id: z.uuid(),
  agencyOrgId: z.uuid(),
  commissionBps: z.int(),
  acceptedAt: z.date(),
  endedAt: z.date().nullable(),
  endReason: z.enum(AGENCY_BILLING_END_REASONS).nullable(),
});

export const ClientAgencyBillingDto = z.object({
  /** Agencies (with a live grant and the flag) offering to pay this org's plan. */
  offers: z.array(z.object({ agencyOrgId: z.uuid(), grantId: z.uuid(), offeredAt: z.date() })),
  /** The live acceptance (it may be accepted but not in force, e.g. the offer was withdrawn). */
  current: AgencyBillingRowDto.nullable(),
  /** Whether the agency pays and earns commission right now. */
  inForce: z.boolean(),
  history: z.array(AgencyBillingRowDto),
});
export type ClientAgencyBillingDto = z.infer<typeof ClientAgencyBillingDto>;

const rowDto = (r: typeof agencyBilling.$inferSelect): z.infer<typeof AgencyBillingRowDto> => ({
  id: r.id,
  agencyOrgId: r.agencyOrgId,
  commissionBps: r.commissionBps,
  acceptedAt: r.acceptedAt,
  endedAt: r.endedAt,
  endReason: (r.endReason as AgencyBillingEndReason | null) ?? null,
});

/** The client's agency billing (its Agencies page): offers, the current one, history. */
export const clientAgencyBillingQuery = tenantQuery({
  name: 'billing.clientAgencyBilling',
  input: z.object({}),
  output: ClientAgencyBillingDto,
  entitlement: null,
  permission: 'members:read',
  handler: async ({ tx }) => {
    const offers = agencyV2Enabled()
      ? await tx.execute<{ agency_org_id: string; grant_id: string; offered_at: Date }>(
          sql`select agency_org_id, grant_id, offered_at from billing.agency_offers_for_me()`,
        )
      : [];
    const rows = await tx.select().from(agencyBilling).orderBy(desc(agencyBilling.acceptedAt)).limit(50);
    const current = rows.find((r) => r.endedAt === null) ?? null;
    return {
      offers: offers.map((o) => ({
        agencyOrgId: o.agency_org_id,
        grantId: o.grant_id,
        offeredAt: new Date(o.offered_at),
      })),
      current: current ? rowDto(current) : null,
      inForce: (await agencyBillingActiveTx(tx)) !== null,
      history: rows.filter((r) => r.endedAt !== null).map(rowDto),
    };
  },
});

/** Accept an agency's offer: the agency pays this org's plan and earns commission on its sales. */
export const acceptAgencyBillingCommand = tenantCommand({
  name: 'billing.acceptAgencyBilling',
  category: 'money',
  input: z.object({ agencyOrgId: z.uuid() }),
  output: AgencyBillingRowDto,
  entitlement: null,
  permission: 'billing:manage',
  // The agency takes a share of every sale from now on.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    requireAgencyV2();
    const acceptedBy = userOf(ctx);
    if (!acceptedBy) throw new DomainError('forbidden', 'Only a member can accept agency billing');
    const [offer] = await tx.execute<{ grant_id: string }>(
      sql`select grant_id from billing.agency_offers_for_me() where agency_org_id = ${input.agencyOrgId}`,
    );
    if (!offer) throw new DomainError('not_found', 'This agency has no offer to pay your plan');
    let row: typeof agencyBilling.$inferSelect | undefined;
    try {
      [row] = await tx
        .insert(agencyBilling)
        .values({
          orgId,
          grantId: offer.grant_id,
          agencyOrgId: input.agencyOrgId,
          commissionBps: DEFAULT_AGENCY_COMMISSION_BPS,
          acceptedBy,
          acceptedAt: ctx.now,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'agency_billing_org_live_key'))
        throw new DomainError('conflict', 'An agency already pays your plan. Stop it first.');
      throw err;
    }
    if (!row) throw new DomainError('internal');
    emit({
      type: 'billing.agency_billing_started',
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, agencyOrgId: row.agencyOrgId, commissionBps: row.commissionBps },
    });
    return rowDto(row);
  },
  audit: (input, r) => ({
    action: 'agencyBilling.accept',
    targetType: 'organization',
    targetId: input.agencyOrgId,
    data: { kind: 'agency_billing', status: 'accepted', total: r?.commissionBps ?? 0 },
  }),
});

async function endTx(
  tx: TenantTx,
  ctx: Ctx,
  reason: AgencyBillingEndReason,
  emit: (e: DomainEvent) => void,
): Promise<boolean> {
  const orgId = requireOrg(ctx);
  const [row] = await tx
    .update(agencyBilling)
    .set({ endedAt: ctx.now, endedBy: userOf(ctx), endReason: reason, updatedAt: ctx.now })
    .where(isNull(agencyBilling.endedAt))
    .returning();
  if (!row) return false;
  emit({
    type: 'billing.agency_billing_ended',
    version: 1,
    aggregateType: 'organization',
    aggregateId: orgId,
    payload: { orgId, agencyOrgId: row.agencyOrgId, reason },
  });
  return true;
}

/** Stop agency billing (the client): it pays for itself again; commission stops on new sales. */
export const endAgencyBillingCommand = tenantCommand({
  name: 'billing.endAgencyBilling',
  category: 'money',
  input: z.object({}),
  output: z.object({ ended: z.boolean() }),
  entitlement: null,
  permission: 'billing:manage',
  handler: async ({ ctx, tx, emit }) => ({ ended: await endTx(tx, ctx, 'client', emit) }),
  audit: (_i, r) => ({
    action: 'agencyBilling.end',
    targetType: 'organization',
    targetId: null,
    data: { kind: 'agency_billing', status: r?.ended ? 'ended' : 'unchanged', reason: 'client' },
  }),
});

/** Staff: change the commission rate of the client's live agency billing (new sales only). */
export const setAgencyCommissionCommand = tenantCommand({
  name: 'billing.setAgencyCommission',
  category: 'money',
  input: z.object({ commissionBps: z.int().min(0).max(5000) }),
  output: z.object({ commissionBps: z.int() }),
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(agencyBilling)
      .set({ commissionBps: input.commissionBps, updatedAt: ctx.now })
      .where(isNull(agencyBilling.endedAt))
      .returning({ bps: agencyBilling.commissionBps });
    if (!row) throw new DomainError('not_found', 'No agency billing to change');
    return { commissionBps: row.bps };
  },
  audit: (input) => ({
    action: 'agencyBilling.commission',
    targetType: 'organization',
    targetId: null,
    data: { kind: 'agency_billing', total: input.commissionBps },
  }),
});

/** A revoked grant ends the agency billing it carried (the database already stops it at once). */
export const agencyBillingGrantRevoked = defineSubscriber({
  name: 'billing.agency-grant-revoked',
  events: ['tenancy.agency_grant_revoked@1'],
  handle: async (tx, event) => {
    const p = event.payload as { grantId?: string };
    if (!p.grantId) return;
    await tx
      .update(agencyBilling)
      .set({ endedAt: new Date(), endReason: 'grant_revoked', updatedAt: new Date() })
      .where(and(eq(agencyBilling.grantId, p.grantId), isNull(agencyBilling.endedAt)));
  },
});
