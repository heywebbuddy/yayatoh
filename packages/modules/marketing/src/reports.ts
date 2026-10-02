import type { TenantTx } from '@yayatoh/db';
import { DomainError } from '@yayatoh/kernel';
import { type OrderOutcomeFact, orderOutcomesTx } from '@yayatoh/orders';
import { tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { conversionBps } from './domain/window.ts';
import {
  type AttributedOrderDto,
  LinkDetailDto,
  LinkReportRowDto,
  type LinkStatsDto,
  type MoneyTotalDto,
  UtmOnlyRowDto,
} from './dto.ts';
import { toLinkDto } from './links.ts';
import { attributions, linkClicks, trackingLinks } from './schema.ts';

/**
 * Link reports (M3.8a). Clicks come from the click log; orders and revenue from the attribution
 * records joined to the orders module's facts (status and totals), so only **sold** orders count
 * (paid, partially refunded or refunded, like M1.12's sales) and revenue is their gross total per
 * currency in integer minor units. Nothing here returns a buyer or a click's hashes.
 */

const MAX_LINKS = 200;

async function outcomes(tx: TenantTx, orderIds: string[]): Promise<Map<string, OrderOutcomeFact>> {
  const out = new Map<string, OrderOutcomeFact>();
  for (let i = 0; i < orderIds.length; i += 5000)
    for (const o of await orderOutcomesTx(tx, orderIds.slice(i, i + 5000))) out.set(o.orderId, o);
  return out;
}

function addMoney(totals: Map<string, number>, currency: string, amount: number) {
  totals.set(currency, (totals.get(currency) ?? 0) + amount);
}
const moneyList = (totals: Map<string, number>): MoneyTotalDto[] =>
  [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));

async function clickCounts(tx: TenantTx, where: ReturnType<typeof eq>) {
  const rows = await tx
    .select({
      linkId: linkClicks.linkId,
      clicks: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct coalesce(${linkClicks.deviceHash}, ${linkClicks.id}::text))::int`,
    })
    .from(linkClicks)
    .where(where)
    .groupBy(linkClicks.linkId);
  return new Map(rows.map((r) => [r.linkId, { clicks: Number(r.clicks), visitors: Number(r.visitors) }]));
}

interface AttributionRow {
  orderId: string;
  model: string;
  firstLinkId: string | null;
  lastLinkId: string | null;
}

function statsFor(
  linkId: string,
  clicks: { clicks: number; visitors: number } | undefined,
  rows: readonly AttributionRow[],
  facts: Map<string, OrderOutcomeFact>,
): LinkStatsDto {
  let orders = 0;
  let firstTouchOrders = 0;
  const revenue = new Map<string, number>();
  for (const r of rows) {
    const o = facts.get(r.orderId);
    if (!o?.sold) continue;
    if (r.lastLinkId === linkId) {
      orders += 1;
      addMoney(revenue, o.currency, o.totalMinor);
    }
    if (r.firstLinkId === linkId) firstTouchOrders += 1;
  }
  const c = clicks ?? { clicks: 0, visitors: 0 };
  return {
    clicks: c.clicks,
    visitors: c.visitors,
    orders,
    firstTouchOrders,
    revenue: moneyList(revenue),
    conversionBps: conversionBps(orders, c.clicks),
  };
}

/** Every tracked link of an event (newest first) with its clicks, orders, revenue and conversion. */
export const linkReportQuery = tenantQuery({
  name: 'marketing.linkReport',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(LinkReportRowDto),
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    const links = await tx
      .select()
      .from(trackingLinks)
      .where(eq(trackingLinks.eventId, input.eventId))
      .orderBy(desc(trackingLinks.createdAt), desc(trackingLinks.id))
      .limit(MAX_LINKS);
    if (links.length === 0) return [];
    const clicks = await clickCounts(tx, eq(linkClicks.eventId, input.eventId));
    const rows = await tx
      .select({
        orderId: attributions.orderId,
        model: attributions.model,
        firstLinkId: attributions.firstLinkId,
        lastLinkId: attributions.lastLinkId,
      })
      .from(attributions)
      .where(and(eq(attributions.eventId, input.eventId), eq(attributions.model, 'click')));
    const facts = await outcomes(
      tx,
      rows.map((r) => r.orderId),
    );
    return links.map((l) => ({ link: toLinkDto(l), stats: statsFor(l.id, clicks.get(l.id), rows, facts) }));
  },
});

/** One link: its figures and the sold or pending orders it touched (first, last or both). */
export const linkDetailQuery = tenantQuery({
  name: 'marketing.linkDetail',
  input: z.object({ linkId: z.uuid() }),
  output: LinkDetailDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    const [link] = await tx.select().from(trackingLinks).where(eq(trackingLinks.id, input.linkId));
    if (!link) throw new DomainError('not_found');
    const clicks = await clickCounts(tx, eq(linkClicks.linkId, link.id));
    const rows = await tx
      .select({
        orderId: attributions.orderId,
        model: attributions.model,
        firstLinkId: attributions.firstLinkId,
        lastLinkId: attributions.lastLinkId,
      })
      .from(attributions)
      .where(or(eq(attributions.firstLinkId, link.id), eq(attributions.lastLinkId, link.id)));
    const facts = await outcomes(
      tx,
      rows.map((r) => r.orderId),
    );
    const orders: AttributedOrderDto[] = [];
    for (const r of rows) {
      const o = facts.get(r.orderId);
      if (!o) continue;
      const first = r.firstLinkId === link.id;
      const last = r.lastLinkId === link.id;
      orders.push({
        orderId: o.orderId,
        touch: first && last ? 'both' : first ? 'first' : 'last',
        status: o.status,
        totalMinor: o.totalMinor,
        currency: o.currency,
        sold: o.sold,
        orderedAt: o.createdAt,
      });
    }
    orders.sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());
    return {
      link: toLinkDto(link),
      stats: statsFor(link.id, clicks.get(link.id), rows, facts),
      orders: orders.slice(0, 500),
    };
  },
});

/** Sold orders of an event attributed by UTM values alone, grouped by source, medium and campaign. */
export const utmOnlyReportQuery = tenantQuery({
  name: 'marketing.utmOnlyReport',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(UtmOnlyRowDto),
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({
        orderId: attributions.orderId,
        source: attributions.utmSource,
        medium: attributions.utmMedium,
        campaign: attributions.utmCampaign,
      })
      .from(attributions)
      .where(and(eq(attributions.eventId, input.eventId), eq(attributions.model, 'utm')));
    const facts = await outcomes(
      tx,
      rows.map((r) => r.orderId),
    );
    const groups = new Map<
      string,
      {
        source: string;
        medium: string | null;
        campaign: string | null;
        orders: number;
        revenue: Map<string, number>;
      }
    >();
    for (const r of rows) {
      const o = facts.get(r.orderId);
      if (!o?.sold || !r.source) continue;
      const key = JSON.stringify([r.source, r.medium, r.campaign]);
      const g = groups.get(key) ?? {
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        orders: 0,
        revenue: new Map<string, number>(),
      };
      g.orders += 1;
      addMoney(g.revenue, o.currency, o.totalMinor);
      groups.set(key, g);
    }
    return [...groups.values()]
      .sort((a, b) => b.orders - a.orders || a.source.localeCompare(b.source))
      .map((g) => ({ ...g, revenue: moneyList(g.revenue) }));
  },
});

/**
 * Clicks on the tracked links a campaign created (M3.6b results; M3.8b builds on it): human
 * clicks (bots are never logged) and distinct devices. Numbers only; no click rows leave here.
 */
export async function campaignClicksTx(
  tx: TenantTx,
  campaignId: string,
): Promise<{ clicks: number; devices: number }> {
  const [row] = await tx
    .select({
      clicks: sql<number>`count(*)::int`,
      devices: sql<number>`count(distinct ${linkClicks.deviceHash})::int`,
    })
    .from(linkClicks)
    .innerJoin(trackingLinks, eq(trackingLinks.id, linkClicks.linkId))
    .where(eq(trackingLinks.campaignId, campaignId));
  return { clicks: row?.clicks ?? 0, devices: row?.devices ?? 0 };
}
