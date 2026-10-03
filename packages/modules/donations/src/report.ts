import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { donationTicketLinesTx } from '@yayatoh/orders';
import { memoEntriesTx } from '@yayatoh/payments';
import { tenantQuery } from '@yayatoh/platform';
import { ticketTypePricesTx } from '@yayatoh/ticketing';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  byDonor,
  byLevel,
  bySource,
  currencyTotals,
  type DonationLine,
  type LineMethod,
  type MatchFact,
  type PledgeFact,
  pledgeSummary,
} from './domain/report.ts';
import { matchProgressTx } from './match-progress.ts';
import { DonationReportDto, ReconTotals } from './report-dto.ts';
import { campaigns, gifts, levels } from './schema.ts';
import { pledgeAttempts, pledgeCollections } from './schema-collection.ts';
import { giftRefunds, matches } from './schema-matches.ts';
import { paddleCalls, pledges } from './schema-paddles.ts';
import { reconRuns } from './schema-reconciliation.ts';

/** The report lists the largest donors; the exports carry every line. */
export const DONOR_ROWS_MAX = 500;

export interface DonationFacts {
  readonly timeZone: string;
  readonly lines: DonationLine[];
  readonly pledges: PledgeFact[];
  readonly matches: MatchFact[];
}

/**
 * Every line of money for the event (M4.8g), read in the caller's tenant transaction: paid gifts
 * (online, QR, or a paddle pledge paid by card or pay link) less their refunds, pledges paid
 * offline, and paid tickets of donation ticket types; plus the paddle pledges with their
 * collection state and the matches. Shared by the report and the exports so both agree.
 */
export async function donationFactsTx(tx: TenantTx, eventId: string): Promise<DonationFacts> {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const [camps, paid, refunded, attempts, pledgeRows, offline, ticketTypes, matchRows] = await Promise.all([
    tx
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.eventId, event.id)),
    tx
      .select()
      .from(gifts)
      .where(and(eq(gifts.eventId, event.id), eq(gifts.status, 'paid'))),
    tx
      .select({ giftId: giftRefunds.giftId, sum: sql<string>`sum(${giftRefunds.amountMinor})::text` })
      .from(giftRefunds)
      .innerJoin(gifts, eq(gifts.id, giftRefunds.giftId))
      .where(eq(gifts.eventId, event.id))
      .groupBy(giftRefunds.giftId),
    tx
      .select({
        giftId: pledgeAttempts.giftId,
        kind: pledgeAttempts.kind,
        paddleNumber: pledges.paddleNumber,
      })
      .from(pledgeAttempts)
      .innerJoin(pledgeCollections, eq(pledgeCollections.id, pledgeAttempts.collectionId))
      .innerJoin(pledges, eq(pledges.id, pledgeCollections.pledgeId))
      .where(and(eq(pledgeCollections.eventId, event.id), eq(pledgeAttempts.status, 'paid'))),
    tx
      .select({
        amountMinor: pledges.amountMinor,
        currency: pledges.currency,
        levelId: paddleCalls.levelId,
        levelName: paddleCalls.levelName,
        status: pledgeCollections.status,
        collectionId: pledgeCollections.id,
      })
      .from(pledges)
      .innerJoin(paddleCalls, eq(paddleCalls.id, pledges.callId))
      .leftJoin(pledgeCollections, eq(pledgeCollections.pledgeId, pledges.id))
      .where(
        and(eq(pledges.eventId, event.id), eq(pledges.status, 'confirmed'), eq(pledges.source, 'paddle')),
      ),
    tx
      .select({
        c: pledgeCollections,
        paddleNumber: pledges.paddleNumber,
        levelId: paddleCalls.levelId,
        levelName: paddleCalls.levelName,
        campaign: campaigns.name,
      })
      .from(pledgeCollections)
      .innerJoin(pledges, eq(pledges.id, pledgeCollections.pledgeId))
      .leftJoin(paddleCalls, eq(paddleCalls.id, pledges.callId))
      .innerJoin(campaigns, eq(campaigns.id, pledgeCollections.campaignId))
      .where(and(eq(pledgeCollections.eventId, event.id), eq(pledgeCollections.status, 'paid_offline'))),
    ticketTypePricesTx(tx, event.id),
    tx.select().from(matches).where(eq(matches.eventId, event.id)),
  ]);
  const campaignName = new Map(camps.map((c) => [c.id, c.name]));
  const levelIds = [...new Set(paid.flatMap((g) => (g.levelId ? [g.levelId] : [])))];
  const levelName = new Map(
    (levelIds.length
      ? await tx.select({ id: levels.id, name: levels.name }).from(levels).where(inArray(levels.id, levelIds))
      : []
    ).map((l) => [l.id, l.name]),
  );
  const refunds = new Map(refunded.map((r) => [r.giftId, Number(r.sum)]));
  const byAttempt = new Map(attempts.map((a) => [a.giftId, a]));
  const lines: DonationLine[] = [];
  for (const g of paid) {
    const attempt = byAttempt.get(g.id);
    lines.push({
      id: g.id,
      source: attempt ? 'paddle' : (g.source as 'online' | 'qr'),
      method: 'card',
      campaignName: campaignName.get(g.campaignId) ?? null,
      levelId: g.levelId,
      levelName: g.levelId ? (levelName.get(g.levelId) ?? null) : null,
      donorName: g.donorName,
      donorEmail: g.donorEmail,
      anonymous: g.displayAs === 'anonymous',
      employer: g.employer,
      tributeKind: g.tributeKind as 'honor' | 'memory' | null,
      tributeName: g.tributeName,
      paddleNumber: attempt?.paddleNumber ?? null,
      date: g.paidAt ?? g.createdAt,
      amountMinor: g.amountMinor,
      feeCoverMinor: g.feeCoverMinor,
      refundedMinor: refunds.get(g.id) ?? 0,
      currency: g.currency,
      orderId: g.orderId,
    });
  }
  for (const o of offline)
    lines.push({
      id: o.c.id,
      source: 'paddle',
      method: (o.c.offlineMethod ?? 'other') as LineMethod,
      campaignName: o.campaign,
      levelId: o.levelId,
      levelName: o.levelName,
      donorName: o.c.donorName,
      donorEmail: o.c.donorEmail,
      anonymous: false,
      employer: null,
      tributeKind: null,
      tributeName: null,
      paddleNumber: o.paddleNumber,
      date: o.c.receivedOn ? new Date(`${o.c.receivedOn}T12:00:00Z`) : (o.c.paidAt ?? o.c.updatedAt),
      amountMinor: o.c.amountMinor,
      feeCoverMinor: 0,
      refundedMinor: 0,
      currency: o.c.currency,
      orderId: null,
    });
  const donationTypes = ticketTypes.filter((t) => t.isDonation).map((t) => t.id);
  for (const t of await donationTicketLinesTx(tx, event.id, donationTypes))
    lines.push({
      id: `${t.orderId}:${t.ticketTypeId}`,
      source: 'ticket',
      method: 'card',
      campaignName: null,
      levelId: null,
      levelName: t.name,
      donorName: t.buyerName,
      donorEmail: t.buyerEmail,
      anonymous: false,
      employer: null,
      tributeKind: null,
      tributeName: null,
      paddleNumber: null,
      date: t.paidAt ?? new Date(0),
      amountMinor: t.unitPaidMinor * t.quantity,
      feeCoverMinor: 0,
      refundedMinor: 0,
      currency: t.currency,
      orderId: t.orderId,
    });
  lines.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  const collectionIds = pledgeRows.flatMap((p) => (p.collectionId ? [p.collectionId] : []));
  const paidBy = new Map(
    (collectionIds.length
      ? await tx
          .select({ collectionId: pledgeAttempts.collectionId, kind: pledgeAttempts.kind })
          .from(pledgeAttempts)
          .where(and(inArray(pledgeAttempts.collectionId, collectionIds), eq(pledgeAttempts.status, 'paid')))
      : []
    ).map((a) => [a.collectionId, a.kind as 'card' | 'link']),
  );
  const pledgeFacts: PledgeFact[] = pledgeRows.map((p) => ({
    amountMinor: p.amountMinor,
    currency: p.currency,
    levelId: p.levelId,
    levelName: p.levelName,
    status: (p.status ?? 'open') as PledgeFact['status'],
    paidBy: p.collectionId ? (paidBy.get(p.collectionId) ?? null) : null,
  }));

  const progress = await matchProgressTx(
    tx,
    matchRows.filter((m) => m.status === 'active'),
  );
  const matchFacts: MatchFact[] = matchRows.map((m) => ({
    id: m.id,
    sponsorName: m.sponsorName,
    publicName: m.publicName,
    campaignName: campaignName.get(m.campaignId) ?? '',
    ratioPercent: m.ratioPercent,
    capMinor: m.capMinor,
    currency: m.currency,
    status: m.status as MatchFact['status'],
    matchedMinor:
      m.status === 'closed'
        ? (m.matchedMinor ?? 0)
        : m.status === 'active'
          ? (progress.get(m.id)?.matchedMinor ?? 0)
          : 0,
    giftCount: progress.get(m.id)?.giftCount ?? 0,
  }));
  return { timeZone: event.timezone, lines, pledges: pledgeFacts, matches: matchFacts };
}

/**
 * The donations report (M4.8g): totals per source, level, match and donor; pledged vs collected
 * vs written off; and the ledger check (the memo entries, and the provider as the last
 * reconciliation saw it). Finance roles and co-hosts (`finance:read`): it names donors.
 */
export const donationReportQuery = tenantQuery({
  name: 'donations.report',
  input: z.object({ eventId: z.uuid() }),
  output: DonationReportDto,
  entitlement: 'donations',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }): Promise<DonationReportDto> => {
    const facts = await donationFactsTx(tx, input.eventId);
    const [memos, [run]] = await Promise.all([
      memoEntriesTx(tx, input.eventId),
      tx
        .select({ totals: reconRuns.totals })
        .from(reconRuns)
        .where(eq(reconRuns.eventId, input.eventId))
        .orderBy(desc(reconRuns.createdAt))
        .limit(1),
    ]);
    const provider = run ? ReconTotals.parse(run.totals) : null;
    const totals = currencyTotals(facts.lines, facts.pledges, facts.matches).map((t) => {
      const p = provider?.find((x) => x.currency === t.currency);
      return {
        ...t,
        ledgerMinor: memos.filter((m) => m.currency === t.currency).reduce((n, m) => n + m.amountMinor, 0),
        providerMinor: provider ? (p?.providerMinor ?? 0) : null,
        providerFeeMinor: provider ? (p?.feeMinor ?? 0) : null,
      };
    });
    const donors = byDonor(facts.lines);
    return {
      eventId: input.eventId,
      timeZone: facts.timeZone,
      asOf: ctx.now,
      totals,
      bySource: bySource(facts.lines),
      byLevel: byLevel(facts.lines, facts.pledges),
      byMatch: facts.matches,
      byDonor: donors.slice(0, DONOR_ROWS_MAX),
      donorsTruncated: donors.length > DONOR_ROWS_MAX,
      pledges: pledgeSummary(facts.pledges),
    };
  },
});
