import { DEFAULT_LOCALE, LOCALES } from '@yayatoh/contracts';

/**
 * A path in a locale with `as-needed` prefixes (roadmap §4.2): English has none, so legacy
 * English URLs keep working; every other locale is prefixed.
 */
export function localizedPath(locale: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return p;
  return p === '/' ? `/${locale}` : `/${locale}${p}`;
}

/** hreflang alternates for a page: one per locale plus x-default (the unprefixed English URL). */
export function hreflangAlternates(origin: string, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LOCALES) out[l] = `${origin}${localizedPath(l, path)}`;
  out['x-default'] = `${origin}${localizedPath(DEFAULT_LOCALE, path)}`;
  return out;
}

/** Next metadata `alternates` for a page in a locale on its canonical origin. */
export function pageAlternates(origin: string, locale: string, path: string) {
  return {
    canonical: `${origin}${localizedPath(locale, path)}`,
    languages: hreflangAlternates(origin, path),
  };
}
