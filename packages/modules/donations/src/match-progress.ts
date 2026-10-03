import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  inWindow,
  type MatchPhase,
  matchableAmount,
  matchedAmount,
  matchPhase,
  remainingToCap,
  resyncedPledge,
} from './domain/matches.ts';
import { LiveMatchDto } from './match-dto.ts';
import { gifts } from './schema.ts';
import { giftRefunds, matches } from './schema-matches.ts';
import { pledges } from './schema-paddles.ts';

type MatchRow = typeof matches.$inferSelect;

/** Where a match stands from its confirmed gifts (M4.8f). */
export interface MatchProgress {
  /** The confirmed gifts in the window it matches (paid online gifts less refunds, paddle pledges). */
  readonly eligibleMinor: number;
  readonly giftCount: number;
  /** What the sponsor's match comes to: the ratio of `eligibleMinor`, never above the cap. */
  readonly matchedMinor: number;
  /** More giving in the window that would use the whole cap. */
  readonly remainingMinor: number;
}

/**
 * Progress of each match, computed from the campaign's confirmed gifts (never stored while a match
 * runs): online gifts that were paid in the window, each less what was refunded of it, and paddle
 * pledges confirmed in the window and not cancelled. Sponsors' own match pledges never count.
 */
export { LiveMatchDto };

export async function matchProgressTx(
  tx: TenantTx,
  rows: readonly MatchRow[],
): Promise<Map<string, MatchProgress>> {
  const out = new Map<string, MatchProgress>();
  if (rows.length === 0) return out;
  const campaignIds = [...new Set(rows.map((m) => m.campaignId))];
  const [paid, refunded, paddle] = await Promise.all([
    tx
      .select({
        id: gifts.id,
        campaignId: gifts.campaignId,
        amountMinor: gifts.amountMinor,
        feeCoverMinor: gifts.feeCoverMinor,
        currency: gifts.currency,
        paidAt: gifts.paidAt,
      })
      .from(gifts)
      .where(and(inArray(gifts.campaignId, campaignIds), eq(gifts.status, 'paid'))),
    tx
      .select({
        giftId: giftRefunds.giftId,
        sum: sql<string>`sum(${giftRefunds.amountMinor})::text`,
      })
      .from(giftRefunds)
      .innerJoin(gifts, eq(gifts.id, giftRefunds.giftId))
      .where(inArray(gifts.campaignId, campaignIds))
      .groupBy(giftRefunds.giftId),
    tx
      .select({
        campaignId: pledges.campaignId,
        amountMinor: pledges.amountMinor,
        currency: pledges.currency,
        confirmedAt: pledges.confirmedAt,
      })
      .from(pledges)
      .where(
        and(
          inArray(pledges.campaignId, campaignIds),
          eq(pledges.source, 'paddle'),
          eq(pledges.status, 'confirmed'),
        ),
      ),
  ]);
  const refunds = new Map(refunded.map((r) => [r.giftId, Number(r.sum)]));
  for (const m of rows) {
    let eligible = 0;
    let count = 0;
    for (const g of paid) {
      if (g.campaignId !== m.campaignId || g.currency !== m.currency || !g.paidAt || !inWindow(g.paidAt, m))
        continue;
      const amount = matchableAmount({ ...g, refundedMinor: refunds.get(g.id) ?? 0 });
      if (amount <= 0) continue;
      eligible += amount;
      count++;
    }
    for (const p of paddle) {
      if (p.campaignId !== m.campaignId || p.currency !== m.currency || !inWindow(p.confirmedAt, m)) continue;
      eligible += p.amountMinor;
      count++;
    }
    out.set(m.id, {
      eligibleMinor: eligible,
      giftCount: count,
      matchedMinor: matchedAmount(eligible, m.ratioPercent, m.capMinor),
      remainingMinor: remainingToCap(eligible, m.ratioPercent, m.capMinor),
    });
  }
  return out;
}

export function liveMatchDto(m: MatchRow, p: MatchProgress | undefined, now: Date): LiveMatchDto {
  return {
    id: m.id,
    campaignId: m.campaignId,
    publicName: m.publicName,
    ratioPercent: m.ratioPercent,
    capMinor: m.capMinor,
    currency: m.currency,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    phase: matchPhase(now, m) as MatchPhase,
    matchedMinor: p?.matchedMinor ?? 0,
    remainingMinor: p?.remainingMinor ?? remainingToCap(0, m.ratioPercent, m.capMinor),
  };
}

/**
 * The event's running matches (status `active`) for the console and screens, oldest window first;
 * `campaignIds` narrows them (the giving page shows only its open campaigns').
 */
export async function activeMatchesTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
  campaignIds?: readonly string[],
): Promise<LiveMatchDto[]> {
  if (campaignIds && campaignIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.eventId, eventId),
        eq(matches.status, 'active'),
        campaignIds ? inArray(matches.campaignId, [...campaignIds]) : undefined,
      ),
    )
    .orderBy(matches.startsAt, matches.id);
  const progress = await matchProgressTx(tx, rows);
  return rows.map((m) => liveMatchDto(m, progress.get(m.id), now));
}

/**
 * After a gift's refund or a paddle pledge's cancellation: every closed match of the campaign whose
 * sponsor's pledge is still open follows its match down (never up; cancelled at zero, P4-12).
 * Returns how many pledges changed.
 */
export async function resyncMatchPledgesTx(tx: TenantTx, campaignId: string, at: Date): Promise<number> {
  const rows = await tx
    .select({ m: matches, pledgeId: pledges.id, pledged: pledges.amountMinor })
    .from(matches)
    .innerJoin(pledges, and(eq(pledges.matchId, matches.id), eq(pledges.status, 'confirmed')))
    .where(and(eq(matches.campaignId, campaignId), eq(matches.status, 'closed')))
    .for('update');
  if (rows.length === 0) return 0;
  const progress = await matchProgressTx(
    tx,
    rows.map((r) => r.m),
  );
  let changed = 0;
  for (const r of rows) {
    const next = resyncedPledge(r.pledged, progress.get(r.m.id)?.matchedMinor ?? 0);
    if (next === r.pledged) continue;
    await tx
      .update(pledges)
      .set(
        next === null
          ? { status: 'cancelled', cancelledAt: at, updatedAt: at }
          : { amountMinor: next, updatedAt: at },
      )
      .where(eq(pledges.id, r.pledgeId));
    changed++;
  }
  return changed;
}
