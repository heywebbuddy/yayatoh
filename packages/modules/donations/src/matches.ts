import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { catchUpSubscriber, defineSubscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MATCH_CAP_MAX_MINOR,
  MATCH_CAP_MIN_MINOR,
  MATCH_RATIO_MAX,
  MATCH_RATIO_MIN,
  MATCH_STATUSES,
  MAX_MATCHES_PER_CAMPAIGN,
  type MatchStatus,
  matchPhase,
} from './domain/matches.ts';
import { activeMatchesTx, type LiveMatchDto, matchProgressTx, resyncMatchPledgesTx } from './match-progress.ts';
import { publishConsoleStateTx } from './paddle-live.ts';
import { paddleEventTx } from './paddles.ts';
import { campaigns, gifts } from './schema.ts';
import { giftRefunds, matches } from './schema-matches.ts';
import { pledges } from './schema-paddles.ts';

type MatchRow = typeof matches.$inferSelect;

const Text = (max: number) => z.string().trim().min(1).max(max);
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const OptionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.email().nullable());

/** A new challenge match (P4-17): its sponsor, window, ratio and cap. */
export const MatchInput = z.object({
  eventId: z.uuid(),
  campaignId: z.uuid(),
  sponsorName: Text(120),
  sponsorEmail: OptionalEmail,
  publicName: OptionalText(120),
  ratioPercent: z.int().min(MATCH_RATIO_MIN).max(MATCH_RATIO_MAX),
  capMinor: z.int().min(MATCH_CAP_MIN_MINOR).max(MATCH_CAP_MAX_MINOR),
  startsAt: z.date(),
  endsAt: z.date(),
});

/** A match as its host sees it: the sponsor's details, where it stands, and its pledge once closed. */
export const MatchDto = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  sponsorName: z.string(),
  sponsorEmail: z.string().nullable(),
  publicName: z.string().nullable(),
  ratioPercent: z.int(),
  capMinor: z.int(),
  currency: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  status: z.enum(MATCH_STATUSES),
  phase: z.enum(['scheduled', 'live', 'ended']),
  eligibleMinor: z.int(),
  giftCount: z.int(),
  matchedMinor: z.int(),
  remainingMinor: z.int(),
  /** The sponsor's pledge (a closed match that came to something). */
  pledge: z
    .object({ id: z.uuid(), amountMinor: z.int(), status: z.enum(['confirmed', 'cancelled']) })
    .nullable(),
  closedAt: z.date().nullable(),
});
export type MatchDto = z.infer<typeof MatchDto>;

export const MatchesViewDto = z.object({
  campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), currency: z.string() })),
  matches: z.array(MatchDto),
  /** Paid gifts that name an employer (P4-17), for the employer matching list. */
  employerGiftCount: z.int(),
});
export type MatchesViewDto = z.infer<typeof MatchesViewDto>;

async function matchOfEventTx(tx: TenantTx, eventId: string, matchId: string) {
  const [row] = await tx
    .select()
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.eventId, eventId)))
    .for('update');
  if (!row) throw new DomainError('not_found', 'Match not found');
  return row;
}

/** Create a challenge match on one of the event's campaigns (in the campaign's currency). */
export const createMatchCommand = tenantCommand({
  name: 'donations.createMatch',
  input: MatchInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.eventId, event.id)))
      .for('update');
    if (!campaign)
      throw new DomainError('validation_failed', 'Choose a campaign', {
        reason: 'campaign',
        field: 'campaignId',
      });
    if (input.endsAt.getTime() <= input.startsAt.getTime())
      throw new DomainError('validation_failed', 'The window must end after it starts', {
        reason: 'window',
        field: 'endsAt',
      });
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(matches)
      .where(eq(matches.campaignId, campaign.id));
    if (n >= MAX_MATCHES_PER_CAMPAIGN)
      throw new DomainError('invalid_state', `At most ${MAX_MATCHES_PER_CAMPAIGN} matches per campaign`, {
        reason: 'too_many',
      });
    const [row] = await tx
      .insert(matches)
      .values({
        orgId: requireOrg(ctx),
        eventId: event.id,
        campaignId: campaign.id,
        sponsorName: input.sponsorName,
        sponsorEmail: input.sponsorEmail,
        publicName: input.publicName,
        ratioPercent: input.ratioPercent,
        capMinor: input.capMinor,
        currency: campaign.currency,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      })
      .returning({ id: matches.id });
    if (!row) throw new DomainError('internal');
    await publishConsoleStateTx(tx, ctx, event.id, event.currency);
    return row;
  },
  // No sponsor contact in the audit log: the terms only.
  audit: (input, r) => ({
    action: 'donations.match.create',
    targetType: 'donation_match',
    targetId: r.id,
    data: {
      eventId: input.eventId,
      campaignId: input.campaignId,
      ratioPercent: input.ratioPercent,
      capMinor: input.capMinor,
    },
  }),
});

/** Withdraw a running match (the sponsor pulled out, or it was a mistake): nothing is pledged. */
export const cancelMatchCommand = tenantCommand({
  name: 'donations.cancelMatch',
  input: z.object({ eventId: z.uuid(), matchId: z.uuid() }),
  output: z.object({ id: z.uuid(), status: z.enum(MATCH_STATUSES) }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const m = await matchOfEventTx(tx, event.id, input.matchId);
    if (m.status !== 'active')
      throw new DomainError('invalid_state', 'Only a running match can be cancelled', {
        reason: `match_${m.status}`,
      });
    await tx
      .update(matches)
      .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
      .where(eq(matches.id, m.id));
    await publishConsoleStateTx(tx, ctx, event.id, event.currency);
    return { id: m.id, status: 'cancelled' as const };
  },
  audit: (input) => ({
    action: 'donations.match.cancel',
    targetType: 'donation_match',
    targetId: input.matchId,
    data: { eventId: input.eventId },
  }),
});

/**
 * Close a match and record the sponsor's pledge (P4-17: the match is the sponsor's own pledge,
 * collected like any other). The window ends now if it was still running; the pledge is what the
 * match came to (none when it came to nothing). A refund or a cancelled paddle pledge later brings
 * the pledge down with the match, never up.
 */
export const closeMatchCommand = tenantCommand({
  name: 'donations.closeMatch',
  input: z.object({ eventId: z.uuid(), matchId: z.uuid() }),
  output: z.object({ id: z.uuid(), matchedMinor: z.int(), pledgeId: z.uuid().nullable() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const m = await matchOfEventTx(tx, event.id, input.matchId);
    if (m.status !== 'active')
      throw new DomainError('invalid_state', 'This match is already closed or cancelled', {
        reason: `match_${m.status}`,
      });
    if (matchPhase(ctx.now, m) === 'scheduled')
      throw new DomainError('invalid_state', 'This match has not started yet', { reason: 'not_started' });
    const endsAt = ctx.now.getTime() < m.endsAt.getTime() ? ctx.now : m.endsAt;
    const closed: MatchRow = { ...m, endsAt };
    const matched = (await matchProgressTx(tx, [closed])).get(m.id)?.matchedMinor ?? 0;
    await tx
      .update(matches)
      .set({ status: 'closed', endsAt, matchedMinor: matched, closedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(matches.id, m.id));
    let pledgeId: string | null = null;
    if (matched > 0) {
      const [p] = await tx
        .insert(pledges)
        .values({
          orgId: requireOrg(ctx),
          eventId: event.id,
          campaignId: m.campaignId,
          matchId: m.id,
          source: 'match',
          amountMinor: matched,
          currency: m.currency,
          confirmedAt: ctx.now,
        })
        .returning({ id: pledges.id });
      pledgeId = p?.id ?? null;
    }
    await publishConsoleStateTx(tx, ctx, event.id, event.currency);
    return { id: m.id, matchedMinor: matched, pledgeId };
  },
  audit: (input, r) => ({
    action: 'donations.match.close',
    targetType: 'donation_match',
    targetId: input.matchId,
    data: { eventId: input.eventId, matchedMinor: r.matchedMinor, pledgeId: r.pledgeId },
  }),
});

/** The event's matches for the host (`orders:read`), newest first, with where each stands. */
export const matchesQuery = tenantQuery({
  name: 'donations.matches',
  input: z.object({ eventId: z.uuid() }),
  output: MatchesViewDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [cs, rows, ps, [emp = { n: 0 }]] = await Promise.all([
      tx
        .select({ id: campaigns.id, name: campaigns.name, currency: campaigns.currency })
        .from(campaigns)
        .where(eq(campaigns.eventId, event.id))
        .orderBy(asc(campaigns.position), asc(campaigns.createdAt)),
      tx
        .select()
        .from(matches)
        .where(eq(matches.eventId, event.id))
        .orderBy(desc(matches.createdAt), desc(matches.id)),
      tx
        .select({ id: pledges.id, matchId: pledges.matchId, amountMinor: pledges.amountMinor, status: pledges.status })
        .from(pledges)
        .where(and(eq(pledges.eventId, event.id), eq(pledges.source, 'match'))),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(gifts)
        .where(and(eq(gifts.eventId, event.id), eq(gifts.status, 'paid'), sql`${gifts.employer} is not null`)),
    ]);
    const progress = await matchProgressTx(tx, rows);
    const pledgeOf = new Map(ps.map((p) => [p.matchId, p]));
    return {
      campaigns: cs,
      employerGiftCount: emp.n,
      matches: rows.map((m) => {
        const p = progress.get(m.id);
        const pledge = pledgeOf.get(m.id);
        // A closed match shows what it came to at close (its pledge may since have come down).
        const matched = m.status === 'closed' ? (pledge?.amountMinor ?? 0) : (p?.matchedMinor ?? 0);
        return {
          id: m.id,
          campaignId: m.campaignId,
          sponsorName: m.sponsorName,
          sponsorEmail: m.sponsorEmail,
          publicName: m.publicName,
          ratioPercent: m.ratioPercent,
          capMinor: m.capMinor,
          currency: m.currency,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          status: m.status as MatchStatus,
          phase: matchPhase(ctx.now, m),
          eligibleMinor: p?.eligibleMinor ?? 0,
          giftCount: p?.giftCount ?? 0,
          matchedMinor: pledge?.status === 'cancelled' ? 0 : matched,
          remainingMinor: m.status === 'active' ? (p?.remainingMinor ?? 0) : 0,
          pledge: pledge
            ? { id: pledge.id, amountMinor: pledge.amountMinor, status: pledge.status as 'confirmed' | 'cancelled' }
            : null,
          closedAt: m.closedAt,
        };
      }),
    };
  },
});

/** The running matches of the event's open campaigns, for the public giving page and screens. */
export async function publicMatches(
  orgId: string,
  eventId: string,
  campaignIds: readonly string[],
): Promise<LiveMatchDto[]> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.public' } });
  return withTenant(ctx, (tx) => activeMatchesTx(tx, eventId, ctx.now, campaignIds));
}

const OrderRefunded = z.object({
  orgId: z.uuid(),
  orderId: z.uuid(),
  refundId: z.uuid(),
  amountMinor: z.int().positive(),
  currency: z.string(),
});

/**
 * A gift's order was refunded (outbox `order.refunded@1`): the refund is recorded against the gift
 * once (unique per refund, so a replay changes nothing), the gift counts that much less toward
 * matches, and a sponsor's recorded pledge comes down with its match.
 */
export const giftRefundsSubscriber = defineSubscriber({
  name: 'donations.gift-refunds',
  events: ['order.refunded@1'],
  handle: async (tx, event) => {
    const p = OrderRefunded.parse(event.payload);
    const [g] = await tx
      .select({ id: gifts.id, orgId: gifts.orgId, campaignId: gifts.campaignId })
      .from(gifts)
      .where(eq(gifts.orderId, p.orderId));
    if (!g) return;
    const at = event.occurredAt ? new Date(event.occurredAt) : new Date();
    const inserted = await tx
      .insert(giftRefunds)
      .values({
        orgId: g.orgId,
        giftId: g.id,
        refundId: p.refundId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        refundedAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: giftRefunds.id });
    if (inserted.length > 0) await resyncMatchPledgesTx(tx, g.campaignId, at);
  },
});

/** Apply this org's gift refunds not handled yet (pages that show matches call it; no worker in dev). */
export function catchUpGiftRefunds(orgId: string) {
  return catchUpSubscriber(giftRefundsSubscriber, orgId);
}
