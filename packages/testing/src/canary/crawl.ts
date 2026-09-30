import { type Leak, leaksIn, type Surface } from './matcher.ts';

/** One fetched response: everything a client could read (body, headers, rendered DOM). */
export interface Fetched {
  readonly status: number;
  readonly contentType: string;
  /** Raw body (for HTML: the server response, including the streamed RSC payload). */
  readonly body: string;
  /** Anything else the client sees: response headers, the hydrated DOM. */
  readonly extra?: string;
}

export interface CrawlOptions {
  readonly start: readonly string[];
  readonly fetch: (url: string) => Promise<Fetched | null>;
  readonly surface?: Surface;
  /** Page cap (breadth-first, so the closest pages are always covered). */
  readonly maxPages?: number;
  /** Extra filter on same-origin links (e.g. skip duplicate locales). */
  readonly follow?: (url: URL) => boolean;
}

export interface CrawlResult {
  readonly visited: readonly string[];
  readonly leaks: readonly Leak[];
  /** 5xx responses: a crash can hide a leak, so the crawl reports them too. */
  readonly errors: readonly { url: string; status: number }[];
}

const ATTR = /\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi;
const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const SITEMAP_LINE = /^\s*Sitemap:\s*(\S+)/gim;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

/** Links in HTML attributes, sitemap `<loc>`s and robots.txt `Sitemap:` lines. */
export function extractLinks(body: string, base: string): string[] {
  const out = new Set<string>();
  for (const re of [ATTR, LOC, SITEMAP_LINE])
    for (const m of body.matchAll(re)) {
      const raw = decode(m[1] ?? '').trim();
      if (!raw || /^(?:mailto|tel|javascript|data|blob):/i.test(raw)) continue;
      try {
        const u = new URL(raw, base);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
        u.hash = '';
        out.add(u.toString());
      } catch {
        // Not a URL (a meta content, a srcset list): skip.
      }
    }
  return [...out];
}

/**
 * Breadth-first crawl from `start`, following links on the start URLs' origins only, up to
 * `maxPages`. Every response (body and extra) is checked for canaries against `surface`
 * (public by default: any canary is a leak).
 */
export async function crawl(o: CrawlOptions): Promise<CrawlResult> {
  const surface = o.surface ?? { kind: 'public' };
  const origins = new Set(o.start.map((s) => new URL(s).origin));
  const queue = [...new Set(o.start)];
  const seen = new Set(queue);
  const visited: string[] = [];
  const leaks: Leak[] = [];
  const errors: { url: string; status: number }[] = [];
  const max = o.maxPages ?? 200;
  while (queue.length && visited.length < max) {
    const url = queue.shift() as string;
    const res = await o.fetch(url);
    visited.push(url);
    if (!res) continue;
    if (res.status >= 500) errors.push({ url, status: res.status });
    leaks.push(...leaksIn(url, `${res.body}\n${res.extra ?? ''}`, surface));
    if (!/html|xml|text\/plain/.test(res.contentType)) continue;
    for (const link of extractLinks(res.body, url)) {
      const u = new URL(link);
      if (!origins.has(u.origin) || seen.has(link) || (o.follow && !o.follow(u))) continue;
      seen.add(link);
      queue.push(link);
    }
  }
  return { visited, leaks, errors };
}
