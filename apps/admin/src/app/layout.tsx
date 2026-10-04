import { UI_STRING_KEYS, UiLocaleProvider } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { fontVariables } from '@/lib/fonts.ts';
import { currentTheme } from '@/server/theme.ts';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  // Staff console: never indexed.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render per request so every page carries this response's CSP nonce (M1.3f, src/proxy.ts).
  await connection();
  // ADR 0022: light by default; the staff member's choice comes from this host's cookie.
  const theme = await currentTheme();
  // The words the form controls say themselves (U1).
  const tf = await getTranslations('formControls');
  const uiStrings = Object.fromEntries(UI_STRING_KEYS.map((k) => [k, tf.raw(k) as string]));
  return (
    <html lang="en" dir="ltr" data-theme={theme} className={fontVariables}>
      <body className="min-h-dvh bg-page text-ink antialiased">
        <NextIntlClientProvider>
          <UiLocaleProvider locale="en" strings={uiStrings}>
            {children}
          </UiLocaleProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
