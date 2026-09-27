import { DEFAULT_LOCALE, LOCALES } from '@yayatoh/contracts';
import { defineRouting } from 'next-intl/routing';

// Path-based locales with `as-needed` prefixes so legacy English URLs keep working (roadmap §4.2).
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
});
