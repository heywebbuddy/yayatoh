import { RTL_LOCALES } from '@yayatoh/contracts';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing.ts';
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
  return (
    <html lang={locale} dir={dir} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-zinc-50 text-zinc-900 antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
