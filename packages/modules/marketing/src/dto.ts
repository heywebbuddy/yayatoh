import { z } from 'zod';
import { ATTRIBUTION_MODELS, MAX_WINDOW_DAYS, MIN_WINDOW_DAYS } from './domain/window.ts';

/** Allowlisted DTOs (M3.8a). Nothing here carries a click's hashes or a buyer's identity. */

const utmValue = z.string().trim().min(1).max(100);

export const CreateTrackedLinkInput = z.object({
  eventId: z.uuid(),
  source: utmValue,
  medium: utmValue,
  campaign: utmValue,
  content: utmValue.nullish(),
  term: utmValue.nullish(),
  label: z.string().trim().min(1).max(80).nullish(),
  /** A path on our own site; empty = the event page. */
  destinationPath: z.string().trim().max(300).nullish(),
  /** Set by M3.6b campaigns and M3.7a journeys (no FK until those tables exist). */
  campaignId: z.uuid().nullish(),
  journeyStepId: z.uuid().nullish(),
});
export type CreateTrackedLinkInput = z.input<typeof CreateTrackedLinkInput>;

export const TrackedLinkDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  code: z.string(),
  label: z.string().nullable(),
  source: z.string(),
  medium: z.string(),
  campaign: z.string(),
  content: z.string().nullable(),
  term: z.string().nullable(),
  destinationPath: z.string().nullable(),
  campaignId: z.uuid().nullable(),
  journeyStepId: z.uuid().nullable(),
  createdAt: z.date(),
});
export type TrackedLinkDto = z.infer<typeof TrackedLinkDto>;

export const MoneyTotalDto = z.object({ currency: z.string(), amountMinor: z.int() });
export type MoneyTotalDto = z.infer<typeof MoneyTotalDto>;

/** Per-link figures: human clicks, attributed sold orders and their revenue per currency. */
export const LinkStatsDto = z.object({
  clicks: z.int(),
  /** Distinct devices that clicked. */
  visitors: z.int(),
  /** Sold orders whose last touch was this link. */
  orders: z.int(),
  /** Sold orders whose first touch was this link. */
  firstTouchOrders: z.int(),
  /** Last-touch revenue: order totals (fees included), per currency, integer minor units. */
  revenue: z.array(MoneyTotalDto),
  /** Last-touch orders per click, in basis points. */
  conversionBps: z.int(),
});
export type LinkStatsDto = z.infer<typeof LinkStatsDto>;

export const LinkReportRowDto = z.object({ link: TrackedLinkDto, stats: LinkStatsDto });
export type LinkReportRowDto = z.infer<typeof LinkReportRowDto>;

export const AttributedOrderDto = z.object({
  orderId: z.uuid(),
  touch: z.enum(['first', 'last', 'both']),
  status: z.string(),
  totalMinor: z.int(),
  currency: z.string(),
  sold: z.boolean(),
  orderedAt: z.date(),
});
export type AttributedOrderDto = z.infer<typeof AttributedOrderDto>;

export const LinkDetailDto = z.object({
  link: TrackedLinkDto,
  stats: LinkStatsDto,
  orders: z.array(AttributedOrderDto),
});
export type LinkDetailDto = z.infer<typeof LinkDetailDto>;

/** UTM-only attribution grouped by source / medium / campaign (orders without a click). */
export const UtmOnlyRowDto = z.object({
  source: z.string(),
  medium: z.string().nullable(),
  campaign: z.string().nullable(),
  orders: z.int(),
  revenue: z.array(MoneyTotalDto),
});
export type UtmOnlyRowDto = z.infer<typeof UtmOnlyRowDto>;

const TouchDto = z.object({
  linkId: z.uuid().nullable(),
  code: z.string().nullable(),
  at: z.date(),
  source: z.string().nullable(),
  medium: z.string().nullable(),
  campaign: z.string().nullable(),
});

/** The attribution record stored on an order. */
export const OrderAttributionDto = z.object({
  orderId: z.uuid(),
  model: z.enum(ATTRIBUTION_MODELS),
  firstTouch: TouchDto,
  lastTouch: TouchDto,
  windowDays: z.int(),
});
export type OrderAttributionDto = z.infer<typeof OrderAttributionDto>;

export const AttributionSettingsDto = z.object({
  windowDays: z.int().min(MIN_WINDOW_DAYS).max(MAX_WINDOW_DAYS),
});
export type AttributionSettingsDto = z.infer<typeof AttributionSettingsDto>;
