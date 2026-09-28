import { LOCALES } from '@yayatoh/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { IncidentBanner } from '@/components/status/incident-banner.tsx';
import { Link } from '@/i18n/navigation.ts';

const navLink = 'inline-flex min-h-10 items-center underline-offset-4 hover:underline';

/**
 * The public site's header: wordmark (home), browse, features, help and organizer links, under
 * the incident banner while the status page reports one (M3.11b).
 */
export async function SiteHeader({ name, browse = true }: { name?: string; browse?: boolean }) {
  const t = await getTranslations('market');
  return (
    <>
    <IncidentBanner variant="site" />
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
      <Link
        href="/"
        className="inline-flex min-h-10 items-center text-[19px] font-semibold tracking-[-0.04em]"
      >
        {name ?? t('wordmark')}
      </Link>
      <nav aria-label={t('siteNav')}>
        <ul className="flex list-none flex-wrap items-center gap-4 p-0 text-body">
          {browse ? (
            <li>
              <Link
                href="/events"
                className="inline-flex min-h-10 items-center underline-offset-4 hover:underline"
              >
                {t('browse')}
              </Link>
            </li>
          ) : null}
          <li>
            <Link href="/features" className={navLink}>
              {t('features')}
            </Link>
          </li>
          <li>
            <Link href="/help" className={navLink}>
              {t('help')}
            </Link>
          </li>
          <li>
            <Link
              href="/sign-in"
              className="inline-flex min-h-10 items-center underline-offset-4 hover:underline"
            >
              {t('forOrganizers')}
            </Link>
          </li>
        </ul>
      </nav>
    </header>
    </>
  );
}

/** Footer: language switch (`/lang/{code}` keeps the page) and "Powered by". */
export async function SiteFooter({ children }: { children?: ReactNode }) {
  const t = await getTranslations('market');
  const home = await getTranslations('home');
  return (
    <footer className="mx-auto mt-16 flex w-full max-w-6xl flex-col gap-4 border-t border-zinc-200 px-4 py-8 md:px-6">
      {children}
      {/* The privacy notice and sub-processors (M1.14c) are linked from every public page. */}
      <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
        <li>
          <Link href="/privacy" className="inline-flex min-h-6 items-center text-zinc-600 underline">
            {home('privacyLink')}
          </Link>
        </li>
        <li>
          <Link href="/sub-processors" className="inline-flex min-h-6 items-center text-zinc-600 underline">
            {home('subProcessorsLink')}
          </Link>
        </li>
        <li>
          <Link href="/help" className="inline-flex min-h-6 items-center text-zinc-600 underline">
            {t('helpCenter')}
          </Link>
        </li>
        <li>
          <Link href="/contact" className="inline-flex min-h-6 items-center text-zinc-600 underline">
            {t('contact')}
          </Link>
        </li>
        <li>
          <Link href="/status" className="inline-flex min-h-6 items-center text-zinc-600 underline">
            {t('status')}
          </Link>
        </li>
      </ul>
      <nav aria-label={t('language')}>
        <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
          {LOCALES.map((l) => (
            <li key={l}>
              <a
                href={`/lang/${l}`}
                hrefLang={l}
                lang={l}
                className="inline-flex min-h-6 items-center text-zinc-600 underline"
              >
                {new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
