import type { ReactNode } from 'react';

/**
 * Headless listbox logic shared by Select, Combobox and the pickers (WAI-ARIA APG listbox and
 * combobox patterns). Pure functions, so the keyboard rules are unit-tested without a browser.
 */
export interface ListOption {
  readonly value: string;
  /** What the option shows (may be rich). */
  readonly label: ReactNode;
  /** Plain text for type-ahead, search and the screen reader. */
  readonly text: string;
  readonly disabled?: boolean;
  /** A second line under the label. */
  readonly hint?: ReactNode;
  /** Group heading (optgroup); options of a group are contiguous. */
  readonly group?: string;
  /** Extra words that match a search (a currency symbol, an abbreviation). */
  readonly keywords?: string;
}

/** A search box appears in the open list above this many options (UX principle 1). */
export const AUTO_SEARCH_ABOVE = 8;
/** PageUp / PageDown step. */
export const PAGE_STEP = 10;

export type ListKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';

export const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const enabled = (o: ListOption | undefined) => Boolean(o && !o.disabled);

/** The next active index for a navigation key, skipping disabled options; -1 when none. */
export function moveActive(options: readonly ListOption[], active: number, key: ListKey): number {
  const n = options.length;
  if (!n || !options.some((o) => !o.disabled)) return -1;
  const firstFrom = (i: number, step: 1 | -1): number => {
    for (let j = i; j >= 0 && j < n; j += step) if (enabled(options[j])) return j;
    return -1;
  };
  const first = firstFrom(0, 1);
  const last = firstFrom(n - 1, -1);
  switch (key) {
    case 'Home':
      return first;
    case 'End':
      return last;
    case 'ArrowDown':
      if (active < 0) return first;
      return firstFrom(active + 1, 1) === -1 ? active : firstFrom(active + 1, 1);
    case 'ArrowUp':
      if (active < 0) return last;
      return firstFrom(active - 1, -1) === -1 ? active : firstFrom(active - 1, -1);
    case 'PageDown': {
      const target = Math.min(n - 1, Math.max(active, 0) + PAGE_STEP);
      const i = firstFrom(target, -1);
      return i < Math.max(active, 0) ? last : i;
    }
    case 'PageUp': {
      const target = Math.max(0, active - PAGE_STEP);
      const i = firstFrom(target, 1);
      return i === -1 || (active >= 0 && i > active) ? first : i;
    }
  }
}

/**
 * Type-ahead: the first enabled option after `from` whose text starts with `buffer`. A buffer of
 * one repeated letter ("bbb") cycles through the options starting with that letter.
 */
export function typeahead(options: readonly ListOption[], buffer: string, from: number): number {
  const q = normalize(buffer);
  if (!q) return -1;
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const prefix = repeated ? (q[0] as string) : q;
  const n = options.length;
  // A longer prefix may still match the current option; a new letter moves past it.
  const start = q.length > 1 && !repeated ? from : from + 1;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    const o = options[i];
    if (enabled(o) && normalize((o as ListOption).text).startsWith(prefix)) return i;
  }
  return -1;
}

/** Options whose text, value or keywords contain every word of the query. */
export function filterOptions<T extends ListOption>(options: readonly T[], query: string): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const hay = normalize(`${o.text} ${o.value} ${o.keywords ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * The value a native `<select>` would submit: the controlled value, else the default, else the
 * first enabled option.
 */
export function initialValue(
  options: readonly ListOption[],
  value: string | undefined,
  defaultValue: string | undefined,
): string {
  if (value !== undefined) return value;
  if (defaultValue !== undefined) return defaultValue;
  return options.find((o) => !o.disabled)?.value ?? '';
}
