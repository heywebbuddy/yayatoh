/**
 * The 13 locales of the web app (ADR 0016), which the apps share: `zh-CN` and `zh-TW` are the names
 * the catalogs use (Expo calls them `zh-Hans` and `zh-Hant`), and Arabic is the one right-to-left
 * language.
 */
export const LOCALES = [
  'en',
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'nl',
  'pt',
  'ru',
  'zh-CN',
  'zh-TW',
] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'en';
export const RTL_LOCALES: readonly AppLocale[] = ['ar'];

export const isAppLocale = (value: unknown): value is AppLocale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

export const isRtlLocale = (locale: AppLocale): boolean => RTL_LOCALES.includes(locale);

/** Each language in its own words, for the language picker. Never translated. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  en: 'English',
  ar: 'العربية',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  hi: 'हिन्दी',
  it: 'Italiano',
  ja: '日本語',
  nl: 'Nederlands',
  pt: 'Português',
  ru: 'Русский',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

/** Maps a BCP 47 tag from the phone (`zh-Hant-TW`, `pt-BR`, `ar_EG`) to one of the 13 locales. */
export function pickLocale(tag: string | null | undefined): AppLocale {
  const parts = (tag ?? '').replace(/_/g, '-').toLowerCase().split('-');
  const language = parts[0] ?? '';
  if (language === 'zh') {
    const traditional =
      parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo');
    return traditional ? 'zh-TW' : 'zh-CN';
  }
  return isAppLocale(language) ? language : DEFAULT_LOCALE;
}

/** The first of the phone's preferred languages that we have a catalog for. */
export function pickFromPreferences(tags: readonly (string | null | undefined)[]): AppLocale {
  for (const tag of tags) {
    const language = (tag ?? '').replace(/_/g, '-').toLowerCase().split('-')[0] ?? '';
    if (language === 'zh' || isAppLocale(language)) return pickLocale(tag);
  }
  return DEFAULT_LOCALE;
}
