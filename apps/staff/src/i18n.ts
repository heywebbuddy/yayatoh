/**
 * Placeholder translations for the M7.1b shell: static catalogs in `messages/<locale>.json` and a
 * device-locale pick. M7.1c replaces this with the shared `use-intl` setup in `@yayatoh/mobile-core`
 * (13 catalogs with plural checks, runtime locale switch, right-to-left through I18nManager).
 */
import ar from '../messages/ar.json';
import de from '../messages/de.json';
import en from '../messages/en.json';
import es from '../messages/es.json';
import fr from '../messages/fr.json';
import hi from '../messages/hi.json';
import it from '../messages/it.json';
import ja from '../messages/ja.json';
import nl from '../messages/nl.json';
import pt from '../messages/pt.json';
import ru from '../messages/ru.json';
import zhCN from '../messages/zh-CN.json';
import zhTW from '../messages/zh-TW.json';

export const catalogs = {
  ar,
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  nl,
  pt,
  ru,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} as const;

export type AppLocale = keyof typeof catalogs;
export const LOCALES = Object.keys(catalogs) as AppLocale[];
export const RTL_LOCALES: readonly AppLocale[] = ['ar'];
export const DEFAULT_LOCALE: AppLocale = 'en';

/** Maps a BCP 47 tag from the phone (`zh-Hant-TW`, `pt-BR`, `ar_EG`) to one of the 13 locales. */
export function pickLocale(tag: string | undefined): AppLocale {
  const parts = (tag ?? '').replace(/_/g, '-').toLowerCase().split('-');
  const language = parts[0] ?? '';
  if (language === 'zh') {
    const traditional =
      parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo');
    return traditional ? 'zh-TW' : 'zh-CN';
  }
  return (LOCALES as string[]).includes(language) ? (language as AppLocale) : DEFAULT_LOCALE;
}

export function deviceLocale(): AppLocale {
  return pickLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}
