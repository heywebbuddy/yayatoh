/**
 * Registration types × admission items (M5.1a), pure. A registration is one registration type,
 * exactly one admission item (full pass, day pass…) and any add-ons, each once; every chosen
 * item must be offered to that type (an enabled cell).
 */

export type AdmissionKind = 'admission' | 'add_on';

/** Seedable defaults (P5 plan, M5.1): names are filled in the organizer's language by the caller. */
export const DEFAULT_TYPE_KEYS = ['member', 'non_member', 'student', 'exhibitor', 'speaker', 'vip'] as const;
export const DEFAULT_ITEMS: readonly { readonly key: string; readonly kind: AdmissionKind }[] = [
  { key: 'full_pass', kind: 'admission' },
  { key: 'day_pass', kind: 'admission' },
  { key: 'workshop', kind: 'add_on' },
  { key: 'dinner', kind: 'add_on' },
];
export const DEFAULT_ITEM_KEYS = DEFAULT_ITEMS.map((i) => i.key);

/** English names for the defaults (tests and when the caller passes none). */
export const DEFAULT_NAMES: Readonly<Record<string, string>> = {
  member: 'Member',
  non_member: 'Non-member',
  student: 'Student',
  exhibitor: 'Exhibitor',
  speaker: 'Speaker',
  vip: 'VIP',
  full_pass: 'Full pass',
  day_pass: 'Day pass',
  workshop: 'Workshop add-on',
  dinner: 'Dinner',
};

/** A stable key from a name: lower-case ASCII letters, digits and `_`, 1–40 characters. */
export function keyFromName(name: string): string {
  const k = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return k || 'type';
}

/** A key not in `taken`: `key`, then `key_2`, `key_3`… */
export function uniqueKey(key: string, taken: ReadonlySet<string>): string {
  if (!taken.has(key)) return key;
  for (let i = 2; ; i++) {
    const k = `${key.slice(0, 36)}_${i}`;
    if (!taken.has(k)) return k;
  }
}

export type SelectionProblem = 'choose_admission' | 'one_admission' | 'item_unavailable' | 'duplicate_item';

/**
 * Check a buyer's items for one type: known and offered to the type, no repeats, exactly one
 * admission item. Returns the problem, or null.
 */
export function selectionProblem(
  chosen: readonly string[],
  offered: ReadonlyMap<string, AdmissionKind>,
): SelectionProblem | null {
  if (new Set(chosen).size !== chosen.length) return 'duplicate_item';
  if (chosen.some((id) => !offered.has(id))) return 'item_unavailable';
  const admissions = chosen.filter((id) => offered.get(id) === 'admission').length;
  if (admissions === 0) return 'choose_admission';
  if (admissions > 1) return 'one_admission';
  return null;
}

/** The lowest and highest price of a type: its cheapest admission alone, its dearest with every add-on. */
export function priceRange(
  cells: readonly { readonly kind: AdmissionKind; readonly allInMinor: number }[],
): { readonly min: number; readonly max: number } | null {
  const admissions = cells.filter((c) => c.kind === 'admission').map((c) => c.allInMinor);
  if (admissions.length === 0) return null;
  const addOns = cells.filter((c) => c.kind === 'add_on').reduce((n, c) => n + c.allInMinor, 0);
  return { min: Math.min(...admissions), max: Math.max(...admissions) + addOns };
}
