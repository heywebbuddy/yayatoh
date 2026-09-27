import { LOCALES } from '@yayatoh/contracts';
import { hreflangAlternates, localizedPath } from './urls.ts';

export interface SitemapPage {
  /** Path without locale prefix, e.g. `/events/harbor-gala`. */
  readonly path: string;
  readonly lastmod: Date | null;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const iso = (d: Date) => d.toISOString();

/** The sitemap index: one per-locale sitemap each (roadmap §7.7: real lastmod). */
export function sitemapIndexXml(origin: string, lastmod: Date | null): string {
  const items = LOCALES.map(
    (l) =>
      `<sitemap><loc>${esc(`${origin}/sitemaps/${l}.xml`)}</loc>${lastmod ? `<lastmod>${iso(lastmod)}</lastmod>` : ''}</sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items.join('')}</sitemapindex>\n`;
}

/** One locale's URLs with every hreflang alternate (xhtml:link) and lastmod. */
export function localeSitemapXml(origin: string, locale: string, pages: readonly SitemapPage[]): string {
  const items = pages.map((p) => {
    const alts = Object.entries(hreflangAlternates(origin, p.path))
      .map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${esc(href)}"/>`)
      .join('');
    const lastmod = p.lastmod ? `<lastmod>${iso(p.lastmod)}</lastmod>` : '';
    return `<url><loc>${esc(`${origin}${localizedPath(locale, p.path)}`)}</loc>${lastmod}${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${items.join('')}</urlset>\n`;
}

/** The most recent lastmod of a set of pages (the index's lastmod). */
export function latest(pages: readonly SitemapPage[]): Date | null {
  let max: Date | null = null;
  for (const p of pages) if (p.lastmod && (!max || p.lastmod > max)) max = p.lastmod;
  return max;
}
