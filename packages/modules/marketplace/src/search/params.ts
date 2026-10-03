import { EVENT_CATEGORIES } from '@yayatoh/events';
import { z } from 'zod';
import { PRICE_BANDS } from './document.ts';

export const SEARCH_PAGE_SIZE = 12;
export const WHEN_PRESETS = ['today', 'week', 'month'] as const;
export type WhenPreset = (typeof WHEN_PRESETS)[number];
export const RADII_KM = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS_KM = 25;
export const SEARCH_SORTS = ['soonest', 'nearest', 'popular'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
/** Bands a visitor can pick (`unpriced` is only a count). */
export const PRICE_FILTER_BANDS = PRICE_BANDS.filter((b) => b !== 'unpriced');

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(t: T) => z.preprocess(blank, t.optional().catch(undefined));
const day = opt(
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`))),
);

/**
 * Search v2 parameters from the URL (M6.14a). Like v1, invalid values are dropped rather than
 * failing the page. `near` is a city name or `me` (then `lat`/`lng` come from the browser).
 */
export const SearchV2Params = z
  .object({
    q: opt(z.string().trim().max(100)),
    city: opt(z.string().trim().max(120)),
    category: opt(z.enum(EVENT_CATEGORIES)),
    price: opt(z.enum(PRICE_FILTER_BANDS as [string, ...string[]])),
    when: opt(z.enum(WHEN_PRESETS)),
    from: day,
    to: day,
    near: opt(z.string().trim().max(120)),
    lat: opt(z.coerce.number().min(-90).max(90)),
    lng: opt(z.coerce.number().min(-180).max(180)),
    radius: opt(z.coerce.number().pipe(z.union(RADII_KM.map((r) => z.literal(r)) as never))),
    sort: opt(z.enum(SEARCH_SORTS)),
    like: opt(
      z
        .string()
        .trim()
        .max(200)
        .regex(/^[a-z0-9-]+$/),
    ),
    page: z.coerce.number().int().min(1).max(200).catch(1).default(1),
  })
  .transform((v) => (v.from && v.to && v.to < v.from ? { ...v, to: undefined } : v));
export type SearchV2Params = z.output<typeof SearchV2Params>;

export function parseSearchV2Params(raw: Record<string, string | string[] | undefined>): SearchV2Params {
  const first = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return SearchV2Params.parse(first);
}

/** Any filter set (the page then shows results rather than recommendations first). */
export function hasFilters(p: SearchV2Params): boolean {
  return Boolean(p.q || p.city || p.category || p.price || p.when || p.from || p.to || p.near);
}

const DAY = 86_400;
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * A preset's time window in unix seconds (UTC days, like v1's date filter: marketplace events
 * span many time zones and a preset is a coarse browse). `today` = until the next UTC midnight.
 */
export function whenWindow(preset: WhenPreset, now: Date): { startsBefore: number } {
  const n = unix(now);
  if (preset === 'today') return { startsBefore: (Math.floor(n / DAY) + 1) * DAY };
  return { startsBefore: n + (preset === 'week' ? 7 : 30) * DAY };
}
