/** One searchable docs entry (built on the server by `searchIndex`). */
export interface DocsEntry {
  readonly kind: 'guide' | 'operation' | 'event';
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly text: string;
}

/**
 * The docs search (M6.3b): every word of the query must appear; guides rank first, then events,
 * then operations, and a title match beats a body match. Pure, so the server (no-JS fallback) and
 * the browser (instant results) agree.
 */
export function matchDocs(index: readonly DocsEntry[], query: string, limit = 20): DocsEntry[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0 || query.trim().length < 2) return [];
  const rank = { guide: 0, event: 1, operation: 2 } as const;
  return index
    .filter((e) => words.every((w) => e.text.includes(w) || e.title.toLowerCase().includes(w)))
    .map((e) => ({ e, title: words.every((w) => e.title.toLowerCase().includes(w)) ? 0 : 1 }))
    .sort(
      (a, b) => a.title - b.title || rank[a.e.kind] - rank[b.e.kind] || a.e.title.localeCompare(b.e.title),
    )
    .slice(0, limit)
    .map((x) => x.e);
}
