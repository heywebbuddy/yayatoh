import { LOCALES } from '@yayatoh/contracts';
import { buttonClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark.tsx';
import { IncidentBanner } from '@/components/status/incident-banner.tsx';
import { ThemeSwitch } from '@/components/theme-switch.tsx';
import { Link } from '@/i18n/navigation.ts';
import { currentTheme } from '@/server/theme.ts';

const navLink =
  'inline-flex min-h-10 items-center rounded-[10px] px-3 font-bold text-ink-2 hover:bg-surface-3 hover:text-ink aria-[current=page]:text-ink';

/**
 * The public site's header (ADR 0022): a floating bar with the wordmark (home), browse, features,
 * pricing (M3.11a), help, the theme switch and the organizer entrance, under the incident banner
 * while the status page reports one (M3.11b).
 */
export async function SiteHeader({ name, browse = true }: { name?: string; browse?: boolean }) {
  const t = await getTranslations('market');
  const theme = await currentTheme();
  return (
    <>
      <IncidentBanner variant="site" />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-5 sm:pt-5">
        <header className="relative z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[22px] border border-line bg-surface p-2.5 ps-4 elevation-card glass">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2.5 rounded-control text-[19px] font-extrabold tracking-[-0.03em] text-ink"
          >
            {name ? null : <BrandMark className="size-7" />}
            {name ?? t('wordmark')}
          </Link>
          <nav aria-label={t('siteNav')} className="order-last w-full sm:order-none sm:w-auto">
            <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-body">
              {browse ? (
                <li>
                  <Link href="/events" className={navLink}>
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
                <Link href="/pricing" className={navLink}>
                  {t('pricing')}
                </Link>
              </li>
              <li>
                <Link href="/help" className={navLink}>
                  {t('help')}
                </Link>
              </li>
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeSwitch initial={theme} />
            <Link href="/sign-in" className={buttonClass('dark')}>
              {t('forOrganizers')}
            </Link>
          </div>
        </header>
      </div>
    </>
  );
}

/** Footer: language switch (`/lang/{code}` keeps the page) and "Powered by". */
export async function SiteFooter({ children }: { children?: ReactNode }) {
  const t = await getTranslations('market');
  const home = await getTranslations('home');
  return (
    <footer className="mx-auto mt-16 flex w-full max-w-6xl flex-col gap-4 border-t border-line px-4 py-8 text-ink-2 md:px-6">
      {children}
      {/* The privacy notice and sub-processors (M1.14c) are linked from every public page. */}
      <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
        <li>
          <Link href="/privacy" className="inline-flex min-h-6 items-center text-ink-2 underline">
            {home('privacyLink')}
          </Link>
        </li>
        <li>
          <Link href="/sub-processors" className="inline-flex min-h-6 items-center text-ink-2 underline">
            {home('subProcessorsLink')}
          </Link>
        </li>
        <li>
          <Link href="/help" className="inline-flex min-h-6 items-center text-ink-2 underline">
            {t('helpCenter')}
          </Link>
        </li>
        <li>
          <Link href="/contact" className="inline-flex min-h-6 items-center text-ink-2 underline">
            {t('contact')}
          </Link>
        </li>
        <li>
          <Link href="/status" className="inline-flex min-h-6 items-center text-ink-2 underline">
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
                className="inline-flex min-h-6 items-center text-ink-2 underline"
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
