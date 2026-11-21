import { DEFAULT_LOCALE } from '@yayatoh/contracts';

/**
 * A locale's whole message catalogue for client components, as its own script file (one per locale).
 * Handing the catalogue to NextIntlClientProvider as a prop wrote all of it (about 800 KB, some 240 KB
 * compressed) into every page's HTML and into the payload of every event-console navigation, and
 * none of that could be cached: on a slow or distant connection that was most of every page load.
 * Imported here, the bundler gives each locale a content-hashed chunk under /_next/static, which
 * the browser downloads once and keeps (immutable). On the server the import reads the same file.
 *
 * The files are the ones `i18n/request.ts` loads for server components, so both sides see the same
 * words. (request.ts also falls back to English for `attendeeDashboard`; every catalogue has it.)
 */
export type Catalogue = Record<string, unknown>;

type Loader = () => Promise<{ default: Catalogue }>;

// One literal import per locale, so each becomes its own chunk and a page loads only its language.
const LOADERS: Readonly<Record<string, Loader>> = {
  en: () => import('../../messages/en.json'),
  ar: () => import('../../messages/ar.json'),
  de: () => import('../../messages/de.json'),
  es: () => import('../../messages/es.json'),
  fr: () => import('../../messages/fr.json'),
  hi: () => import('../../messages/hi.json'),
  it: () => import('../../messages/it.json'),
  ja: () => import('../../messages/ja.json'),
  nl: () => import('../../messages/nl.json'),
  pt: () => import('../../messages/pt.json'),
  ru: () => import('../../messages/ru.json'),
  'zh-CN': () => import('../../messages/zh-CN.json'),
  'zh-TW': () => import('../../messages/zh-TW.json'),
};

// One promise per locale for the life of the page (or server process): React's `use` reads a
// promise it has seen settle without suspending again, so only the first render waits.
const loaded = new Map<string, Promise<Catalogue>>();

/** The catalogue of a locale (the default locale's for an unknown one). */
export function catalogue(locale: string): Promise<Catalogue> {
  const key = Object.hasOwn(LOADERS, locale) ? locale : DEFAULT_LOCALE;
  let p = loaded.get(key);
  if (!p) {
    const load = LOADERS[key] as Loader;
    p = load().then((m) => m.default);
    loaded.set(key, p);
  }
  return p;
}

/** The locales that have a catalogue here (a test keeps it in step with the routing). */
export const CATALOGUE_LOCALES: readonly string[] = Object.keys(LOADERS);
