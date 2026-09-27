import { z } from 'zod';

export const PAGE_SIZE = 12;
export const PRICE_FILTERS = ['free', 'paid'] as const;
export const CATEGORIES = ['gala', 'concert', 'conference', 'community', 'other'] as const;

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const day = z.preprocess(
  blank,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
    .optional()
    .catch(undefined),
);

/**
 * Marketplace search and filters from URL parameters. Invalid values are dropped rather than
 * failing the page (a shared link with a stale filter still works).
 */
export const SearchParams = z
  .object({
    q: z.preprocess(blank, z.string().trim().max(100).optional().catch(undefined)),
    city: z.preprocess(blank, z.string().trim().max(120).optional().catch(undefined)),
    category: z.preprocess(blank, z.enum(CATEGORIES).optional().catch(undefined)),
    price: z.preprocess(blank, z.enum(PRICE_FILTERS).optional().catch(undefined)),
    from: day,
    to: day,
    page: z.coerce.number().int().min(1).max(500).catch(1).default(1),
  })
  .transform((v) => (v.from && v.to && v.to < v.from ? { ...v, to: undefined, from: v.from } : v));
export type SearchParams = z.output<typeof SearchParams>;

/** Read the first value of each parameter from Next's searchParams shape. */
export function parseSearchParams(raw: Record<string, string | string[] | undefined>): SearchParams {
  const first = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return SearchParams.parse(first);
}

/** Escape LIKE wildcards so a search for "50%" matches the text, not everything. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * A day range in the viewer's terms: `from` includes the whole day, `to` includes the whole day
 * (exclusive end is the next midnight). Days are UTC calendar days: marketplace events span many
 * timezones and a filter is a coarse browse, not a booking boundary.
 */
export function dayRange(p: Pick<SearchParams, 'from' | 'to'>): { from: Date | null; to: Date | null } {
  const from = p.from ? new Date(`${p.from}T00:00:00Z`) : null;
  const to = p.to ? new Date(Date.parse(`${p.to}T00:00:00Z`) + 86_400_000) : null;
  return { from, to };
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}
