import { RTL_LOCALES } from '@yayatoh/contracts';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MaintenanceBanner } from '@/components/maintenance-banner.tsx';
import { routing } from '@/i18n/routing.ts';
import { fontVariables } from '@/lib/fonts.ts';
import { INTL_SCOPE_HEADER, scopedMessages } from '@/lib/intl-scope.ts';
import { currentTheme } from '@/server/theme.ts';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return { title: t('title'), description: t('description') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Render per request so every page carries this response's CSP nonce (M1.14a). Cached public
  // pages with build-time hashes come with CDN caching (docs/specs/M1.14/spec.md, "Later").
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
  // ADR 0022: light by default; the person's choice comes from a cookie read here, so the first
  // HTML already carries it (no flash). "system" is resolved by CSS.
  const theme = await currentTheme();
  // M4.7a: a scoped page (proxy.ts) sends its client components only the namespaces it needs.
  const messages = scopedMessages(await getMessages(), (await headers()).get(INTL_SCOPE_HEADER));
  return (
    <html lang={locale} dir={dir} data-theme={theme} className={fontVariables}>
      <body className="min-h-dvh bg-page text-ink antialiased">
        {/* Platform-wide read-only freeze (M2.5a): on every page, public ones included. */}
        <MaintenanceBanner locale={locale} />
        <NextIntlClientProvider {...(messages ? { messages } : {})}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
