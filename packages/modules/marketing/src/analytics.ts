import { defineSerializer } from '@yayatoh/contracts';
import { csvRow } from '@yayatoh/csv';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { campaignSendStatsTx } from '@yayatoh/notifications';
import { type OrderOutcomeFact, orderOutcomesTx } from '@yayatoh/orders';
import { tenantQuery } from '@yayatoh/platform';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { and, desc, eq, gte, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type AnalyticsLink,
  type AttributionFact,
  aggregate,
  type ClickTally,
  type DayRange,
  DIMENSIONS,
  type Dimension,
  dayRange,
  MAX_RANGE_DAYS,
  parseCampaignKey,
  type SendFact,
} from './domain/analytics.ts';
import { attributions, linkClicks, trackingLinks } from './schema.ts';

/**
 * Marketing analytics queries (M3.8b): campaign → registrations and revenue per campaign, channel
 * and link over a date range in the org's time zone, a campaign's drill-down and the CSV export.
 * Every read runs in the caller's tenant transaction (RLS); outputs are allowlisted DTOs of
 * numbers and link metadata — never a buyer, a click's hashes or an ORM row.
 */

const MAX_LINKS = 2000;
const SLACK_MS = 24 * 3_600_000;

const Count = z.int().min(0);
const CreditDto = z.object({ orders: Count, revenueMinor: z.int() });
export const FiguresDto = z.object({
  sends: Count.nullable(),
  deliveries: Count.nullable(),
  clicks: Count,
  uniqueClickers: Count,
  firstTouch: CreditDto,
  lastTouch: CreditDto,
  otherCurrencyOrders: Count,
  conversionBps: Count,
});
export type FiguresDto = z.infer<typeof FiguresDto>;

export const ROW_KINDS = ['campaign', 'utm', 'channel', 'link'] as const;

export const AnalyticsRowDto = FiguresDto.extend({
  key: z.string(),
  kind: z.enum(ROW_KINDS),
  /** Campaign or link name (null: unnamed; the page words it). */
  name: z.string().nullable(),
  /** Link rows: its UTM values, code and event. */
  link: z
    .object({
      id: z.uuid(),
      code: z.string(),
      source: z.string(),
      medium: z.string(),
      campaign: z.string(),
      eventName: z.string().nullable(),
      eventSlug: z.string().nullable(),
    })
    .nullable(),
});
export type AnalyticsRowDto = z.infer<typeof AnalyticsRowDto>;

export const AnalyticsReportDto = z.object({
  dimension: z.enum(DIMENSIONS),
  currency: z.string(),
  timeZone: z.string(),
  fromDay: z.string(),
  toDay: z.string(),
  rows: z.array(AnalyticsRowDto),
  totals: FiguresDto,
});
export type AnalyticsReportDto = z.infer<typeof AnalyticsReportDto>;

export const RangeInput = z.object({
  from: z.string().max(10).nullish(),
  to: z.string().max(10).nullish(),
  /** Without `from`: the last N days up to `to` (or today), in the org's time zone. */
  days: z.int().min(1).max(MAX_RANGE_DAYS).nullish(),
});

/** The org's zone and currency, and the requested range (a bad range is a validation error). */
async function scopeTx(tx: TenantTx, ctx: Ctx, input: z.infer<typeof RangeInput>) {
  const org = await organizationDefaultsTx(tx, requireOrg(ctx));
  if (!org) throw new DomainError('not_found');
  const range = dayRange(input, org.timezone, ctx.now);
  if ('problem' in range)
    throw new DomainError('validation_failed', 'Choose a valid date range', {
      reason: range.problem,
      field: range.problem === 'invalid_date' ? 'from' : 'to',
    });
  return { ...org, range };
}

type LinkRow = typeof trackingLinks.$inferSelect;

interface Facts {
  links: LinkRow[];
  clicks: ClickTally[];
  attributions: AttributionFact[];
  orders: Map<string, OrderOutcomeFact>;
  sends: SendFact[];
  sendsByCampaign: Map<
    string,
    { sent: number; delivered: number; bounced: number; complained: number; channels: Set<string> }
  >;
}

/** Gather the facts for a range (optionally one event's links, or a set of links). */
async function factsTx(
  tx: TenantTx,
  range: DayRange,
  opts: { eventId?: string; linkWhere?: SQL } = {},
): Promise<Facts> {
  const where = [
    ...(opts.eventId ? [eq(trackingLinks.eventId, opts.eventId)] : []),
    ...(opts.linkWhere ? [opts.linkWhere] : []),
  ];
  const links = await tx
    .select()
    .from(trackingLinks)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(trackingLinks.createdAt), desc(trackingLinks.id))
    .limit(MAX_LINKS);
  const linkIds = links.map((l) => l.id);
  const inRange = (col: typeof linkClicks.clickedAt) => and(gte(col, range.from), lt(col, range.to)) as SQL;

  const clickRows = linkIds.length
    ? await tx
        .select({
          linkId: linkClicks.linkId,
          visitor: sql<string>`coalesce(${linkClicks.deviceHash}, ${linkClicks.id}::text)`,
          clicks: sql<number>`count(*)::int`,
        })
        .from(linkClicks)
        .where(and(inRange(linkClicks.clickedAt), inArray(linkClicks.linkId, linkIds)))
        .groupBy(linkClicks.linkId, sql`2`)
    : [];

  // Attribution records are written when the order is created: read the range with a day's slack
  // either side, then keep the orders created inside it (the aggregation checks the order's time).
  const attrWhere: SQL[] = [
    gte(attributions.createdAt, new Date(range.from.getTime() - SLACK_MS)),
    lt(attributions.createdAt, new Date(range.to.getTime() + SLACK_MS)),
  ];
  if (opts.eventId) attrWhere.push(eq(attributions.eventId, opts.eventId));
  const attrRows = await tx
    .select({
      orderId: attributions.orderId,
      model: attributions.model,
      firstLinkId: attributions.firstLinkId,
      lastLinkId: attributions.lastLinkId,
      utmMedium: attributions.utmMedium,
      utmCampaign: attributions.utmCampaign,
      firstUtmMedium: attributions.firstUtmMedium,
      firstUtmCampaign: attributions.firstUtmCampaign,
    })
    .from(attributions)
    .where(and(...attrWhere));
  const ids = new Set(linkIds);
  const scoped = opts.linkWhere
    ? attrRows.filter(
        (r) => (r.firstLinkId && ids.has(r.firstLinkId)) || (r.lastLinkId && ids.has(r.lastLinkId)),
      )
    : attrRows;

  const orders = new Map<string, OrderOutcomeFact>();
  const orderIds = scoped.map((r) => r.orderId);
  for (let i = 0; i < orderIds.length; i += 5000)
    for (const o of await orderOutcomesTx(tx, orderIds.slice(i, i + 5000))) orders.set(o.orderId, o);

  const campaignIds = new Set(links.flatMap((l) => (l.campaignId ? [l.campaignId] : [])));
  const allSends = await campaignSendStatsTx(tx, range);
  // With an event (or link) scope, only the campaigns that link there count their sends.
  const sendRows =
    opts.eventId || opts.linkWhere ? allSends.filter((s) => campaignIds.has(s.campaignId)) : allSends;
  const sendsByCampaign: Facts['sendsByCampaign'] = new Map();
  for (const s of sendRows) {
    const c = sendsByCampaign.get(s.campaignId) ?? {
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      channels: new Set<string>(),
    };
    c.sent += s.sent;
    c.delivered += s.delivered;
    c.bounced += s.bounced;
    c.complained += s.complained;
    c.channels.add(s.channel);
    sendsByCampaign.set(s.campaignId, c);
  }
  return {
    links,
    clicks: clickRows.map((r) => ({
      linkId: r.linkId,
      visitor: String(r.visitor),
      clicks: Number(r.clicks),
    })),
    attributions: scoped,
    orders,
    sends: sendRows.map((s) => ({
      campaignId: s.campaignId,
      channel: s.channel,
      sent: s.sent,
      delivered: s.delivered,
    })),
    sendsByCampaign,
  };
}

const toAnalyticsLink = (l: LinkRow): AnalyticsLink => ({
  id: l.id,
  campaignId: l.campaignId,
  medium: l.utmMedium,
  campaign: l.utmCampaign,
});

/** Event names and slugs for link rows (a handful of events per report). */
async function eventNamesTx(tx: TenantTx, ids: Iterable<string>) {
  const out = new Map<string, { name: string; slug: string }>();
  for (const id of new Set(ids)) {
    const e = await findEventTx(tx, id);
    if (e) out.set(id, { name: e.name, slug: e.slug });
  }
  return out;
}

async function rowsFor(tx: TenantTx, dimension: Dimension, facts: Facts, currency: string, range: DayRange) {
  const { rows, totals } = aggregate({
    dimension,
    currency,
    links: facts.links.map(toAnalyticsLink),
    clicks: facts.clicks,
    attributions: facts.attributions,
    orders: facts.orders,
    range,
    sends: facts.sends,
  });
  // Names: a messaging campaign's newest link label (its name) or UTM campaign.
  const campaignNames = new Map<string, string>();
  for (const l of facts.links)
    if (l.campaignId && !campaignNames.has(l.campaignId))
      campaignNames.set(l.campaignId, l.label ?? l.utmCampaign);
  const linkById = new Map(facts.links.map((l) => [l.id, l]));
  const events =
    dimension === 'link'
      ? await eventNamesTx(
          tx,
          rows.flatMap((r) => {
            const l = linkById.get(r.key.slice(2));
            return l ? [l.eventId] : [];
          }),
        )
      : new Map<string, { name: string; slug: string }>();
  const out: AnalyticsRowDto[] = rows.map((r) => {
    const id = r.key.slice(2);
    if (r.key.startsWith('c.'))
      return { ...r, kind: 'campaign', name: campaignNames.get(id) ?? null, link: null };
    if (r.key.startsWith('u.')) return { ...r, kind: 'utm', name: id || null, link: null };
    if (r.key.startsWith('m.')) return { ...r, kind: 'channel', name: id || null, link: null };
    const l = linkById.get(id);
    const e = l ? events.get(l.eventId) : undefined;
    return {
      ...r,
      kind: 'link',
      name: l?.label ?? null,
      link: l
        ? {
            id: l.id,
            code: l.code,
            source: l.utmSource,
            medium: l.utmMedium,
            campaign: l.utmCampaign,
            eventName: e?.name ?? null,
            eventSlug: e?.slug ?? null,
          }
        : null,
    };
  });
  return { rows: out, totals };
}

export const AnalyticsInput = RangeInput.extend({
  dimension: z.enum(DIMENSIONS).default('campaign'),
  /** One event's links only (the Command Center tile). */
  eventId: z.uuid().nullish(),
});

/** Marketing analytics for a range: one row per campaign, channel or link, and the totals. */
export async function analyticsReportTx(
  tx: TenantTx,
  ctx: Ctx,
  input: z.input<typeof AnalyticsInput>,
): Promise<AnalyticsReportDto> {
  const i = AnalyticsInput.parse(input);
  const { timezone, currency, range } = await scopeTx(tx, ctx, i);
  const facts = await factsTx(tx, range, i.eventId ? { eventId: i.eventId } : {});
  const { rows, totals } = await rowsFor(tx, i.dimension, facts, currency, range);
  return AnalyticsReportDto.parse({
    dimension: i.dimension,
    currency,
    timeZone: timezone,
    fromDay: range.fromDay,
    toDay: range.toDay,
    rows,
    totals,
  });
}

export const analyticsReportQuery = tenantQuery({
  name: 'marketing.analyticsReport',
  input: AnalyticsInput,
  output: AnalyticsReportDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: ({ input, ctx, tx }) => analyticsReportTx(tx, ctx, input),
});

// --- One campaign ----------------------------------------------------------------------------

export const CampaignOrderDto = z.object({
  orderId: z.uuid(),
  touch: z.enum(['first', 'last', 'both']),
  status: z.string(),
  totalMinor: z.int(),
  currency: z.string(),
  orderedAt: z.date(),
  eventName: z.string().nullable(),
  eventSlug: z.string().nullable(),
});

export const CampaignDetailDto = z.object({
  key: z.string(),
  kind: z.enum(['campaign', 'utm']),
  name: z.string().nullable(),
  currency: z.string(),
  timeZone: z.string(),
  fromDay: z.string(),
  toDay: z.string(),
  figures: FiguresDto,
  /** Email and text messages the campaign sent in the range (null for UTM campaigns). */
  delivery: z
    .object({
      channels: z.array(z.string()),
      sent: Count,
      delivered: Count,
      bounced: Count,
      complained: Count,
      bounceBps: Count,
      complaintBps: Count,
    })
    .nullable(),
  links: z.array(AnalyticsRowDto),
  orders: z.array(CampaignOrderDto),
});
export type CampaignDetailDto = z.infer<typeof CampaignDetailDto>;

const bps = (part: number, whole: number) => (whole > 0 ? Math.floor((part * 10_000) / whole) : 0);

export const campaignDetailQuery = tenantQuery({
  name: 'marketing.campaignDetail',
  input: RangeInput.extend({ key: z.string().min(2).max(120) }),
  output: CampaignDetailDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, ctx, tx }) => {
    const parsed = parseCampaignKey(input.key);
    if (!parsed) throw new DomainError('not_found');
    const { timezone, currency, range } = await scopeTx(tx, ctx, input);
    const linkWhere =
      parsed.kind === 'campaign'
        ? eq(trackingLinks.campaignId, parsed.id)
        : (and(
            eq(trackingLinks.utmCampaign, parsed.campaign),
            sql`${trackingLinks.campaignId} is null`,
          ) as SQL);
    const facts = await factsTx(tx, range, { linkWhere });
    if (parsed.kind === 'utm') {
      // UTM-only orders of this UTM campaign join the links' records.
      const utm = await tx
        .select({
          orderId: attributions.orderId,
          model: attributions.model,
          firstLinkId: attributions.firstLinkId,
          lastLinkId: attributions.lastLinkId,
          utmMedium: attributions.utmMedium,
          utmCampaign: attributions.utmCampaign,
          firstUtmMedium: attributions.firstUtmMedium,
          firstUtmCampaign: attributions.firstUtmCampaign,
        })
        .from(attributions)
        .where(
          and(
            eq(attributions.model, 'utm'),
            parsed.campaign
              ? or(
                  eq(attributions.utmCampaign, parsed.campaign),
                  eq(attributions.firstUtmCampaign, parsed.campaign),
                )
              : sql`(${attributions.utmCampaign} is null or ${attributions.firstUtmCampaign} is null)`,
            gte(attributions.createdAt, new Date(range.from.getTime() - SLACK_MS)),
            lt(attributions.createdAt, new Date(range.to.getTime() + SLACK_MS)),
          ),
        );
      facts.attributions.push(...utm);
      const ids = utm.map((r) => r.orderId);
      for (let i = 0; i < ids.length; i += 5000)
        for (const o of await orderOutcomesTx(tx, ids.slice(i, i + 5000))) facts.orders.set(o.orderId, o);
    }
    const send = parsed.kind === 'campaign' ? facts.sendsByCampaign.get(parsed.id) : undefined;
    if (facts.links.length === 0 && !send && facts.attributions.length === 0)
      throw new DomainError('not_found');

    const campaign = await rowsFor(tx, 'campaign', facts, currency, range);
    const row = campaign.rows.find((r) => r.key === input.key);
    const zero = {
      sends: null,
      deliveries: null,
      clicks: 0,
      uniqueClickers: 0,
      firstTouch: { orders: 0, revenueMinor: 0 },
      lastTouch: { orders: 0, revenueMinor: 0 },
      otherCurrencyOrders: 0,
      conversionBps: 0,
    };
    const {
      key: _k,
      kind: _kind,
      name: _n,
      link: _l,
      ...figures
    } = row ?? { ...zero, key: '', kind: 'utm', name: null, link: null };
    const links = (await rowsFor(tx, 'link', facts, currency, range)).rows;

    // The orders it touched in the range (first, last or both).
    const linkIds = new Set(facts.links.map((l) => l.id));
    const touched: Array<z.infer<typeof CampaignOrderDto>> = [];
    const eventOf = new Map<string, string>();
    for (const r of facts.attributions) {
      const o = facts.orders.get(r.orderId);
      if (!o?.sold || o.createdAt < range.from || o.createdAt >= range.to) continue;
      const first =
        r.model === 'click'
          ? Boolean(r.firstLinkId && linkIds.has(r.firstLinkId))
          : parsed.kind === 'utm' && (r.firstUtmCampaign ?? r.utmCampaign ?? '') === parsed.campaign;
      const last =
        r.model === 'click'
          ? Boolean(r.lastLinkId && linkIds.has(r.lastLinkId))
          : parsed.kind === 'utm' && (r.utmCampaign ?? '') === parsed.campaign;
      if (!first && !last) continue;
      if (touched.some((t) => t.orderId === o.orderId)) continue;
      eventOf.set(o.orderId, o.eventId);
      touched.push({
        orderId: o.orderId,
        touch: first && last ? 'both' : first ? 'first' : 'last',
        status: o.status,
        totalMinor: o.totalMinor,
        currency: o.currency,
        orderedAt: o.createdAt,
        eventName: null,
        eventSlug: null,
      });
    }
    touched.sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());
    const shown = touched.slice(0, 200);
    const events = await eventNamesTx(
      tx,
      shown.flatMap((t) => (eventOf.get(t.orderId) ? [eventOf.get(t.orderId) as string] : [])),
    );
    for (const t of shown) {
      const e = events.get(eventOf.get(t.orderId) ?? '');
      t.eventName = e?.name ?? null;
      t.eventSlug = e?.slug ?? null;
    }
    const name =
      parsed.kind === 'campaign'
        ? (facts.links[0]?.label ?? facts.links[0]?.utmCampaign ?? null)
        : parsed.campaign || null;
    return {
      key: input.key,
      kind: parsed.kind,
      name,
      currency,
      timeZone: timezone,
      fromDay: range.fromDay,
      toDay: range.toDay,
      figures,
      delivery: send
        ? {
            channels: [...send.channels].sort(),
            sent: send.sent,
            delivered: send.delivered,
            bounced: send.bounced,
            complained: send.complained,
            bounceBps: bps(send.bounced, send.sent),
            complaintBps: bps(send.complained, send.sent),
          }
        : parsed.kind === 'campaign'
          ? { channels: [], sent: 0, delivered: 0, bounced: 0, complained: 0, bounceBps: 0, complaintBps: 0 }
          : null,
      links,
      orders: shown,
    };
  },
});

// --- CSV -------------------------------------------------------------------------------------

/** One CSV line of the export: an allowlist (names, UTM values and numbers; no buyer, no hash). */
export const AnalyticsCsvRow = z.strictObject({
  name: z.string(),
  event: z.string(),
  source: z.string(),
  medium: z.string(),
  campaign: z.string(),
  code: z.string(),
  sends: z.string(),
  deliveries: z.string(),
  clicks: Count,
  uniqueClickers: Count,
  firstTouchOrders: Count,
  firstTouchRevenueMinor: z.int(),
  lastTouchOrders: Count,
  lastTouchRevenueMinor: z.int(),
  otherCurrencyOrders: Count,
  conversionPct: z.string(),
  currency: z.string(),
});
export type AnalyticsCsvRow = z.infer<typeof AnalyticsCsvRow>;
export const analyticsCsvSerializer = defineSerializer('marketing.analyticsCsvRow', AnalyticsCsvRow);

export const ANALYTICS_CSV_COLUMNS = [
  'name',
  'event',
  'source',
  'medium',
  'campaign',
  'code',
  'sends',
  'deliveries',
  'clicks',
  'uniqueClickers',
  'firstTouchOrders',
  'firstTouchRevenueMinor',
  'lastTouchOrders',
  'lastTouchRevenueMinor',
  'otherCurrencyOrders',
  'conversionPct',
  'currency',
] as const satisfies readonly (keyof AnalyticsCsvRow)[];
export type AnalyticsCsvColumn = (typeof ANALYTICS_CSV_COLUMNS)[number];

/** Conversion in percent with two decimals, from basis points (`2500` → `25.00`). */
export const bpsToPct = (v: number) => `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;

/**
 * The report as CSV (UTF-8 with a BOM for spreadsheet apps; formula-like cells neutralised):
 * a header row in the reader's language (`headers`), one line per row, then the totals line.
 * `label` words names the page shows in its own words (unnamed rows, the totals line).
 */
export function analyticsCsv(
  report: AnalyticsReportDto,
  headers: Readonly<Record<AnalyticsCsvColumn, string>>,
  label: { readonly unnamed: string; readonly total: string },
): string {
  const line = (name: string, f: FiguresDto, link: AnalyticsRowDto['link']): string => {
    const r = analyticsCsvSerializer.serialize({
      name,
      event: link?.eventName ?? '',
      source: link?.source ?? '',
      medium: link?.medium ?? '',
      campaign: link?.campaign ?? '',
      code: link?.code ?? '',
      sends: f.sends === null ? '' : String(f.sends),
      deliveries: f.deliveries === null ? '' : String(f.deliveries),
      clicks: f.clicks,
      uniqueClickers: f.uniqueClickers,
      firstTouchOrders: f.firstTouch.orders,
      firstTouchRevenueMinor: f.firstTouch.revenueMinor,
      lastTouchOrders: f.lastTouch.orders,
      lastTouchRevenueMinor: f.lastTouch.revenueMinor,
      otherCurrencyOrders: f.otherCurrencyOrders,
      conversionPct: bpsToPct(f.conversionBps),
      currency: report.currency,
    });
    return csvRow(ANALYTICS_CSV_COLUMNS.map((c) => r[c]));
  };
  let out = `﻿${csvRow(ANALYTICS_CSV_COLUMNS.map((c) => headers[c]))}`;
  for (const r of report.rows) out += line(r.name ?? label.unnamed, r, r.link);
  out += line(label.total, report.totals, null);
  return out;
}
