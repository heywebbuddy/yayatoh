import { splitName, surnameSortKey } from './names.ts';

export const BATCH_SORTS = ['last_name', 'company'] as const;
export type BatchSort = (typeof BATCH_SORTS)[number];

export interface SortableBadge {
  readonly id: string;
  readonly holderName: string;
  readonly company: string;
  /** Tie-breaker: the ticket's serial within its event (stable across runs). */
  readonly serial: number;
}

/**
 * Batch order (M5.5a): A–Z by last name (then first name), or by company A–Z with badges that
 * have no company last, each company's people A–Z by last name. Locale-aware collation (accents
 * and case don't split a letter), numeric-aware ("Room 9" before "Room 10"); the serial breaks
 * ties so the order is total and reruns are identical.
 */
export function sortBadges<T extends SortableBadge>(rows: readonly T[], sort: BatchSort, locale = 'en'): T[] {
  const coll = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const keyed = rows.map((r) => {
    const n = splitName(r.holderName);
    return { r, last: surnameSortKey(n.last) || n.first, first: n.first, company: r.company.trim() };
  });
  const byName = (a: (typeof keyed)[number], b: (typeof keyed)[number]) =>
    coll.compare(a.last, b.last) || coll.compare(a.first, b.first) || a.r.serial - b.r.serial;
  keyed.sort((a, b) => {
    if (sort === 'company') {
      if (!a.company !== !b.company) return a.company ? -1 : 1;
      const c = coll.compare(a.company, b.company);
      if (c) return c;
    }
    return byName(a, b);
  });
  return keyed.map((k) => k.r);
}
