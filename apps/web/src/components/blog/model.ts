import { markdownToPlainText } from '@yayatoh/contracts';
import { parseMarkdown } from '@yayatoh/events/ui';

/** What a blog card and the featured hero need, whether the post is the platform's or an organization's. */
export interface BlogCard {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly excerpt: string;
  readonly coverUrl: string | null;
  readonly coverAlt: string;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly date: Date;
  readonly minutes: number;
  readonly author: string | null;
}

/** About 200 words a minute, at least one. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 200));

export const wordCount = (markdown: string) =>
  markdownToPlainText(markdown).split(/\s+/).filter(Boolean).length;

/** A summary line for a card: the excerpt, else the start of the body. */
export const excerptOf = (excerpt: string | null, body: string) =>
  excerpt?.trim() || `${markdownToPlainText(body).slice(0, 160).trim()}…`;

const plain = (nodes: readonly { t: string; v?: string; c?: unknown }[]): string =>
  nodes
    .map((n) =>
      n.t === 'text' || n.t === 'code' ? (n.v ?? '') : plain((n.c ?? []) as { t: string; v?: string }[]),
    )
    .join('');

export interface Heading {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

/** The headings of a body with unique anchor ids (the table of contents and the article agree on them). */
export function headingsOf(markdown: string): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  for (const b of parseMarkdown(markdown)) {
    if (b.t !== 'h') continue;
    const text = plain(b.c as never);
    const base =
      text
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'section';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ id: n === 1 ? base : `${base}-${n}`, text, level: b.level });
  }
  return out;
}

/** Filter by category and a search over title, summary, category and tags. */
export function filterCards(cards: readonly BlogCard[], q: string, category: string): BlogCard[] {
  const needle = q.trim().toLowerCase();
  return cards.filter(
    (c) =>
      (!category || c.category?.toLowerCase() === category.toLowerCase()) &&
      (!needle ||
        `${c.title} ${c.excerpt} ${c.category ?? ''} ${c.tags.join(' ')} ${c.author ?? ''}`
          .toLowerCase()
          .includes(needle)),
  );
}

export const categoriesOf = (cards: readonly BlogCard[]): string[] => {
  const counts = new Map<string, { label: string; n: number }>();
  for (const c of cards) {
    if (!c.category) continue;
    const k = c.category.toLowerCase();
    counts.set(k, { label: counts.get(k)?.label ?? c.category, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((v) => v.label);
};
