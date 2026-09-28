import type { ColumnId } from './registry.ts';
import { PHONE_PREFIX, phoneColumns, privateColumnList } from './registry.ts';

export type LeakClass = 'secret' | 'personal' | 'internal' | 'holder' | 'unknown';

/**
 * Where a response goes, which decides which canaries may appear in it (roadmap §9):
 * - `public`: anyone (pages, sitemaps, feeds, the widget, `/v1/public`). No canary at all.
 * - `scoped`: the org itself (its API key, its exports) or its door staff (the scanner manifest).
 *   Only the columns its allowlist names, and never a `secret`.
 * - `outbound`: messages the platform sends (emails, push, webhooks). Never a `secret` or an
 *   `internal` column (the recipient's own personal and holder data are the message).
 */
export type Surface =
  | { readonly kind: 'public' }
  | { readonly kind: 'scoped'; readonly allow: readonly ColumnId[] }
  | { readonly kind: 'outbound' };

export interface Hit {
  readonly column: ColumnId;
  readonly class: LeakClass;
  /** The text that matched. */
  readonly match: string;
}

export interface Leak extends Hit {
  /** URL or name of the response it was found in. */
  readonly where: string;
}

const TOKEN = /__canary_([a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+)__/gi;
const PHONE = new RegExp(`\\+?${PHONE_PREFIX.slice(1)}(\\d)\\d{3}`, 'g');

let classes: Map<ColumnId, LeakClass> | null = null;
let phones: ColumnId[] | null = null;
const classOf = (id: ColumnId): LeakClass => {
  classes ??= new Map(privateColumnList().map((c) => [c.id, c.rule.class]));
  return classes.get(id) ?? 'unknown';
};

/** Every canary in `text`, once per column. A canary with no registered column is `unknown`. */
export function findCanaries(text: string): Hit[] {
  const out = new Map<ColumnId, Hit>();
  for (const m of text.matchAll(TOKEN)) {
    const column = (m[1] ?? '').toLowerCase();
    if (!out.has(column)) out.set(column, { column, class: classOf(column), match: m[0] });
  }
  phones ??= phoneColumns();
  for (const m of text.matchAll(PHONE)) {
    const column = phones[Number(m[1])] ?? `phone.${m[1]}`;
    if (!out.has(column)) out.set(column, { column, class: classOf(column), match: m[0] });
  }
  return [...out.values()];
}

/** Whether a canary may appear on this surface. */
export function allowed(hit: Hit, surface: Surface): boolean {
  if (surface.kind === 'public') return false;
  if (surface.kind === 'outbound') return hit.class === 'personal' || hit.class === 'holder';
  return hit.class !== 'secret' && hit.class !== 'unknown' && surface.allow.includes(hit.column);
}

/** The canaries in one response that its surface does not allow. */
export function leaksIn(where: string, text: string, surface: Surface): Leak[] {
  return findCanaries(text)
    .filter((h) => !allowed(h, surface))
    .map((h) => ({ ...h, where }));
}

/** A failure message listing every hit: URL, column and class. */
export function formatLeaks(leaks: readonly Leak[]): string {
  if (!leaks.length) return 'no canary leaks';
  const lines = leaks.map((l) => `  ${l.where}\n    ${l.column} (${l.class}) ← ${JSON.stringify(l.match)}`);
  return `${leaks.length} canary leak(s):\n${lines.join('\n')}`;
}
