/**
 * Help center and marketing site rules (M3.11b): pure functions, no database. Search ranking,
 * related articles, the per-slug locale fallback and the marketing call-to-action links.
 */

export const HELP_AUDIENCES = ['organizers', 'buyers'] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

export const SITE_PLACEMENTS = ['home', 'features', 'contact'] as const;
export type SitePlacement = (typeof SITE_PLACEMENTS)[number];

export const CONTACT_TOPICS = ['sales', 'support', 'partnership', 'other'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const FEEDBACK_REASONS = ['unclear', 'incomplete', 'outdated', 'other'] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** Content missing in the reader's locale is shown in English. */
export const FALLBACK_LOCALE = 'en';

/** Longest query we rank (characters) and most terms we keep. */
export const SEARCH_MAX_QUERY = 120;
export const SEARCH_MAX_TERMS = 8;

/**
 * Per slug, the row in `locale`, else the English one (rows in other locales are ignored). Keeps
 * the input order of the chosen rows.
 */
export function pickLocale<T extends { readonly slug: string; readonly locale: string }>(
  rows: readonly T[],
  locale: string,
  key: (r: T) => string = (r) => r.slug,
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    if (r.locale !== locale && r.locale !== FALLBACK_LOCALE) continue;
    const k = key(r);
    const prev = best.get(k);
    if (!prev || (r.locale === locale && prev.locale !== locale)) best.set(k, r);
  }
  const chosen = new Set(best.values());
  return rows.filter((r) => chosen.has(r));
}

// Scripts written without spaces between words: a single character is a meaningful term there.
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/**
 * Lower-cased, accent- and width-folded (NFKD without combining marks) text. Queries and articles
 * go through the same folding, so marks never decide a match in any script.
 */
export function foldText(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The distinct search terms of a query (at most 8; one-letter terms only in CJK/Thai). */
export function searchTerms(query: string): string[] {
  const out: string[] = [];
  for (const w of words(foldText(query.slice(0, SEARCH_MAX_QUERY)))) {
    if (w.length < 2 && !NO_SPACES.test(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length === SEARCH_MAX_TERMS) break;
  }
  return out;
}

export interface SearchDoc {
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly keywords: string | null;
  readonly body: string;
}

interface Field {
  readonly text: string;
  readonly words: readonly string[];
}
const field = (s: string | null): Field => {
  const text = foldText(s ?? '');
  return { text, words: words(text) };
};

/** Weights per field: a whole word, a word start, anywhere inside (CJK has no word breaks). */
const WEIGHTS = {
  title: [12, 8, 5],
  keywords: [7, 5, 3],
  summary: [4, 3, 2],
  body: [2, 1.5, 1],
} as const;

function termScore(term: string, f: Field, w: readonly [number, number, number]): number {
  if (!f.text.includes(term)) return 0;
  if (f.words.includes(term)) return w[0];
  if (f.words.some((x) => x.startsWith(term))) return w[1];
  return w[2];
}

export interface Ranked<T> {
  readonly doc: T;
  readonly score: number;
  /** How many of the query's terms the article contains. */
  readonly matched: number;
}

/**
 * Rank articles for a query. An article must contain at least one term; articles holding more
 * of the terms rank first, then by score (title > keywords > summary > body, whole words over
 * word starts over inner matches, a bonus when the whole query appears in the title or summary),
 * then by title. An empty query ranks nothing.
 */
export function rankArticles<T extends SearchDoc>(query: string, docs: readonly T[]): Ranked<T>[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const phrase = words(foldText(query.slice(0, SEARCH_MAX_QUERY))).join(' ');
  const ranked: Ranked<T>[] = [];
  for (const doc of docs) {
    const fields = {
      title: field(doc.title),
      keywords: field(doc.keywords),
      summary: field(doc.summary),
      body: field(doc.body),
    };
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const best = Math.max(
        termScore(term, fields.title, WEIGHTS.title),
        termScore(term, fields.keywords, WEIGHTS.keywords),
        termScore(term, fields.summary, WEIGHTS.summary),
        termScore(term, fields.body, WEIGHTS.body),
      );
      if (best > 0) {
        matched++;
        score += best;
      }
    }
    if (matched === 0) continue;
    if (terms.length > 1 && phrase) {
      if (fields.title.words.join(' ').includes(phrase)) score += 10;
      else if (fields.summary.words.join(' ').includes(phrase)) score += 4;
    }
    ranked.push({ doc, score, matched });
  }
  return ranked.sort(
    (a, b) =>
      b.matched - a.matched ||
      b.score - a.score ||
      a.doc.title.localeCompare(b.doc.title) ||
      a.doc.slug.localeCompare(b.doc.slug),
  );
}

export interface RelatedDoc {
  readonly slug: string;
  readonly categorySlug: string;
  readonly title: string;
  readonly keywords: string | null;
  readonly position: number;
}

const keywordSet = (k: string | null) =>
  new Set(
    (k ?? '')
      .split(',')
      .map((x) => foldText(x).trim())
      .filter(Boolean),
  );

/**
 * Articles to suggest under one: others in its category (by position, then title), then others
 * sharing its keywords (most shared first). Never the article itself; at most `limit`.
 */
export function relatedArticles<T extends RelatedDoc>(article: RelatedDoc, all: readonly T[], limit = 4): T[] {
  const byOrder = (a: T, b: T) => a.position - b.position || a.title.localeCompare(b.title);
  const same = all.filter((d) => d.slug !== article.slug && d.categorySlug === article.categorySlug).sort(byOrder);
  const mine = keywordSet(article.keywords);
  const shared = (d: T) => [...keywordSet(d.keywords)].filter((k) => mine.has(k)).length;
  const others = all
    .filter((d) => d.slug !== article.slug && d.categorySlug !== article.categorySlug && shared(d) > 0)
    .sort((a, b) => shared(b) - shared(a) || byOrder(a, b));
  return [...same, ...others].slice(0, limit);
}

/**
 * A marketing call to action may link a page of this site (`/features`, `/sign-in`) or an https
 * address; never `//host`, `javascript:` or other schemes.
 */
export function ctaHrefProblem(href: string): 'format' | null {
  if (href.length > 300) return 'format';
  if (href === '/' || /^\/[^/\\]/.test(href)) return /[\s<>"']/.test(href) ? 'format' : null;
  if (!href.startsWith('https://')) return 'format';
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? null : 'format';
  } catch {
    return 'format';
  }
}

/** A readable excerpt of Markdown for search results: markup removed, whitespace collapsed. */
export function plainExcerpt(markdown: string, max = 180): string {
  const text = markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
