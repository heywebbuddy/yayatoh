import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { onlineGivingTx } from '@yayatoh/orders';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type CampaignStatus,
  DEFAULT_MAX_GIFT_MINOR,
  DEFAULT_MIN_GIFT_MINOR,
  type DisplayAs,
  type GiftStatus,
  shownName,
  type TributeKind,
} from './domain/giving.ts';
import {
  type CampaignDto,
  CampaignInput,
  DonationsConsoleDto,
  type LevelDto,
  LevelInput,
  UpdateCampaignInput,
} from './dto.ts';
import { offlinePledgeTotalsTx } from './pledge-totals.ts';
import { campaigns, gifts, levels } from './schema.ts';
import { giftRefunds } from './schema-matches.ts';
import { publishScreenStateTx, screenEventsOfCampaignTx } from './screen-live.ts';

type CampaignRow = typeof campaigns.$inferSelect;

/** The event, in this org, for a host write. */
async function eventFor(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  return event;
}

/** A campaign of this event (locked for a write when `forUpdate`). */
export async function campaignOfEventTx(
  tx: TenantTx,
  eventId: string,
  campaignId: string,
  forUpdate = false,
): Promise<CampaignRow> {
  const q = tx
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.eventId, eventId)));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found', 'Campaign not found');
  return row;
}

const limitsProblem = (min: number, max: number) =>
  max < min
    ? new DomainError('validation_failed', 'The largest gift must be at least the smallest', {
        reason: 'limits',
        field: 'maxGiftMinor',
      })
    : null;

const nameTaken = (err: unknown, field = 'name') =>
  isUniqueViolation(err)
    ? new DomainError('conflict', 'That name is taken', { field, reason: 'name_taken' })
    : err;

export const createCampaignCommand = tenantCommand({
  name: 'donations.createCampaign',
  input: CampaignInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await eventFor(tx, input.eventId);
    const min = input.minGiftMinor ?? DEFAULT_MIN_GIFT_MINOR;
    const max = input.maxGiftMinor ?? DEFAULT_MAX_GIFT_MINOR;
    const bad = limitsProblem(min, max);
    if (bad) throw bad;
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(eq(campaigns.eventId, event.id));
    if (n >= 20)
      throw new DomainError('invalid_state', 'At most 20 campaigns per event', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(campaigns)
        .values({
          orgId: requireOrg(ctx),
          eventId: event.id,
          name: input.name,
          description: input.description,
          goalMinor: input.goalMinor,
          currency: event.currency,
          minGiftMinor: min,
          maxGiftMinor: max,
          position: n,
        })
        .returning({ id: campaigns.id });
      if (!row) throw new DomainError('internal');
      return row;
    } catch (err) {
      throw nameTaken(err);
    }
  },
  audit: (input, r) => ({
    action: 'donations.campaign.create',
    targetType: 'donation_campaign',
    targetId: r.id,
    data: { eventId: input.eventId, goalMinor: input.goalMinor },
  }),
});

export const updateCampaignCommand = tenantCommand({
  name: 'donations.updateCampaign',
  input: UpdateCampaignInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const c = await campaignOfEventTx(tx, input.eventId, input.campaignId, true);
    const bad = limitsProblem(input.minGiftMinor, input.maxGiftMinor);
    if (bad) throw bad;
    try {
      await tx
        .update(campaigns)
        .set({
          name: input.name,
          description: input.description,
          goalMinor: input.goalMinor,
          minGiftMinor: input.minGiftMinor,
          maxGiftMinor: input.maxGiftMinor,
          status: input.status,
          updatedAt: ctx.now,
        })
        .where(eq(campaigns.id, c.id));
    } catch (err) {
      throw nameTaken(err);
    }
    // A new name or goal reaches the room's screen at once (M4.8d).
    for (const eventId of await screenEventsOfCampaignTx(tx, c.id))
      await publishScreenStateTx(tx, requireOrg(ctx), eventId);
    return { id: c.id };
  },
  audit: (input) => ({
    action: 'donations.campaign.update',
    targetType: 'donation_campaign',
    targetId: input.campaignId,
    data: { goalMinor: input.goalMinor, status: input.status },
  }),
});

export const createLevelCommand = tenantCommand({
  name: 'donations.createLevel',
  input: LevelInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const c = await campaignOfEventTx(tx, input.eventId, input.campaignId, true);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(levels)
      .where(eq(levels.campaignId, c.id));
    if (n >= 12) throw new DomainError('invalid_state', 'At most 12 levels', { reason: 'too_many' });
    try {
      const [row] = await tx
        .insert(levels)
        .values({
          orgId: requireOrg(ctx),
          campaignId: c.id,
          name: input.name,
          amountMinor: input.amountMinor,
          description: input.description,
        })
        .returning({ id: levels.id });
      if (!row) throw new DomainError('internal');
      return row;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'A level with this amount exists', {
          field: 'amountMinor',
          reason: 'amount_taken',
        });
      throw err;
    }
  },
  audit: (input, r) => ({
    action: 'donations.level.create',
    targetType: 'donation_level',
    targetId: r.id,
    data: { campaignId: input.campaignId, amountMinor: input.amountMinor },
  }),
});

/** Removing a level keeps its gifts (their level is cleared). */
export const deleteLevelCommand = tenantCommand({
  name: 'donations.deleteLevel',
  input: z.object({ eventId: z.uuid(), levelId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'donations',
  permission: 'events:write',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const [l] = await tx
      .select({ id: levels.id, campaignId: levels.campaignId })
      .from(levels)
      .where(eq(levels.id, input.levelId));
    if (!l) throw new DomainError('not_found', 'Level not found');
    await campaignOfEventTx(tx, input.eventId, l.campaignId, true);
    await tx.delete(levels).where(eq(levels.id, l.id));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'donations.level.delete',
    targetType: 'donation_level',
    targetId: input.levelId,
  }),
});

/** Levels of these campaigns, by campaign, smallest amount first. */
export async function levelsByCampaignTx(tx: TenantTx, campaignIds: readonly string[]) {
  const out = new Map<string, LevelDto[]>();
  if (campaignIds.length === 0) return out;
  const rows = await tx
    .select()
    .from(levels)
    .where(inArray(levels.campaignId, [...campaignIds]))
    .orderBy(asc(levels.amountMinor));
  for (const r of rows)
    out.set(r.campaignId, [
      ...(out.get(r.campaignId) ?? []),
      { id: r.id, name: r.name, amountMinor: r.amountMinor, description: r.description },
    ]);
  return out;
}

/**
 * Totals of paid gifts per campaign (sums, never rows: a replayed payment cannot count twice).
 * M4.8g: net of refunds; a refund takes the covered fee first, then the gift (as matches do).
 */
export async function campaignTotalsTx(tx: TenantTx, campaignIds: readonly string[]) {
  const out = new Map<string, { raisedMinor: number; giftCount: number; feeCoverMinor: number }>();
  if (campaignIds.length === 0) return out;
  const refunded = sql`coalesce((select sum(${giftRefunds.amountMinor}) from ${giftRefunds} where ${giftRefunds.giftId} = ${gifts.id}), 0)`;
  const rows = await tx
    .select({
      campaignId: gifts.campaignId,
      raised: sql<string>`coalesce(sum(greatest(0, ${gifts.amountMinor} - greatest(0, ${refunded} - ${gifts.feeCoverMinor}))), 0)::text`,
      covered: sql<string>`coalesce(sum(greatest(0, ${gifts.feeCoverMinor} - ${refunded})), 0)::text`,
      n: sql<number>`count(*)::int`,
    })
    .from(gifts)
    .where(and(inArray(gifts.campaignId, [...campaignIds]), eq(gifts.status, 'paid')))
    .groupBy(gifts.campaignId);
  for (const r of rows)
    out.set(r.campaignId, {
      raisedMinor: Number(r.raised),
      giftCount: r.n,
      feeCoverMinor: Number(r.covered),
    });
  // M4.8e: pledges the host recorded as paid offline count like paid gifts (P4-12).
  for (const [campaignId, o] of await offlinePledgeTotalsTx(tx, campaignIds)) {
    const t = out.get(campaignId) ?? { raisedMinor: 0, giftCount: 0, feeCoverMinor: 0 };
    out.set(campaignId, {
      ...t,
      raisedMinor: t.raisedMinor + o.raisedMinor,
      giftCount: t.giftCount + o.count,
    });
  }
  return out;
}

/** The event's campaigns (by position), with levels and totals. */
export async function campaignsOfEventTx(tx: TenantTx, eventId: string): Promise<CampaignDto[]> {
  const rows = await tx
    .select()
    .from(campaigns)
    .where(eq(campaigns.eventId, eventId))
    .orderBy(asc(campaigns.position), asc(campaigns.createdAt));
  const ids = rows.map((r) => r.id);
  const [lv, totals] = await Promise.all([levelsByCampaignTx(tx, ids), campaignTotalsTx(tx, ids)]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    goalMinor: r.goalMinor,
    currency: r.currency,
    minGiftMinor: r.minGiftMinor,
    maxGiftMinor: r.maxGiftMinor,
    status: r.status as CampaignStatus,
    levels: lv.get(r.id) ?? [],
    raisedMinor: totals.get(r.id)?.raisedMinor ?? 0,
    giftCount: totals.get(r.id)?.giftCount ?? 0,
    feeCoverMinor: totals.get(r.id)?.feeCoverMinor ?? 0,
  }));
}

/**
 * The Donations tab: whether giving works (connected account), campaigns with levels and totals,
 * and the paid gifts with each donor's name only as they chose it (P4-13).
 */
export const donationsConsoleQuery = tenantQuery({
  name: 'donations.console',
  input: z.object({ eventId: z.uuid() }),
  output: DonationsConsoleDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const event = await eventFor(tx, input.eventId);
    const list = await campaignsOfEventTx(tx, event.id);
    const levelNames = new Map(list.flatMap((c) => c.levels.map((l) => [l.id, l.name] as const)));
    const rows = await tx
      .select()
      .from(gifts)
      .where(and(eq(gifts.eventId, event.id), eq(gifts.status, 'paid')))
      .orderBy(desc(gifts.paidAt), desc(gifts.id))
      .limit(500);
    const [{ pending } = { pending: 0 }] = await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(gifts)
      .where(and(eq(gifts.eventId, event.id), eq(gifts.status, 'pending')));
    return {
      connected: (await onlineGivingTx(tx)).connected,
      campaigns: list,
      gifts: rows.map((g) => ({
        id: g.id,
        campaignId: g.campaignId,
        levelName: g.levelId ? (levelNames.get(g.levelId) ?? null) : null,
        status: g.status as GiftStatus,
        amountMinor: g.amountMinor,
        feeCoverMinor: g.feeCoverMinor,
        currency: g.currency,
        shownName: shownName(g.donorName, g.displayAs as DisplayAs),
        tribute:
          g.tributeKind && g.tributeName ? { kind: g.tributeKind as TributeKind, name: g.tributeName } : null,
        createdAt: g.createdAt,
        paidAt: g.paidAt,
      })),
      pendingCount: pending,
    };
  },
});
