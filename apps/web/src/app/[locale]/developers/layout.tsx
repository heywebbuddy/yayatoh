import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';

/**
 * The public developer docs (M6.3b): guides, the API reference generated from OpenAPI, and the
 * webhook event catalog. The shell is translated in every locale; the reference content is English
 * (marked `lang="en"`, left-to-right).
 */
export default async function DevelopersLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('developers');
  const nav = [
    { href: '/developers', label: t('nav.home') },
    { href: '/developers/guides', label: t('nav.guides') },
    { href: '/developers/reference', label: t('nav.reference') },
    { href: '/developers/events', label: t('nav.events') },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-10 focus:rounded-pill focus:bg-white focus:px-4 focus:py-2"
      >
        {t('skip')}
      </a>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/developers" className="flex min-h-11 items-center text-section font-medium">
            {t('brand')}
          </Link>
          <nav aria-label={t('nav.label')}>
            <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className="inline-flex min-h-11 items-center rounded-pill px-3 text-body hover:bg-zinc-100"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
