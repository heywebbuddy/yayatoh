'use client';

import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode, use, useMemo } from 'react';
import { catalogue } from '@/i18n/catalogue.ts';
import { profileMessages } from '@/lib/profile-copy.ts';

/**
 * Gives client components the locale's messages from its cached catalogue file (`i18n/catalogue.ts`)
 * instead of from a prop written into the page, so the page and every navigation stay small. With
 * a `profile`, the event's profile rewording applies (M4.2a), as `profileMessages` did on the server.
 * The server passes the locale and time zone it resolved, so dates and numbers read the same on
 * both sides.
 */
export function CatalogueIntlProvider({
  locale,
  timeZone,
  profile,
  children,
}: {
  locale: string;
  timeZone: string;
  profile?: string;
  children: ReactNode;
}) {
  const all = use(catalogue(locale));
  const messages = useMemo(() => (profile ? profileMessages(all, profile) : all), [all, profile]);
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
