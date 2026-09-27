import 'server-only';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';

/**
 * Validate the `[locale]` segment before a page formats anything with it. Pages render alongside
 * the layout, so a stray single-segment URL (`/favicon.ico`) must 404 here too.
 */
export function pageLocale(locale: string): string {
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
