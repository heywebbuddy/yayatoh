import { buttonClass, cx } from '@yayatoh/ui';
import { Menu, Search } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/brand-mark.tsx';
import { IncidentBanner } from '@/components/status/incident-banner.tsx';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { dashboardAccess } from '@/server/dashboard-access.ts';
import { currentGuestSession } from '@/server/guest.ts';
import { SOLUTION_KEYS } from './solutions.ts';

const link =
  'inline-flex min-h-10 items-center whitespace-nowrap rounded-pill px-3.5 text-body font-bold text-ink-2 hover:bg-surface-3 hover:text-ink aria-[current=page]:text-ink';
const summary = `${link} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;
const popover =
  'absolute end-0 top-full z-10 m-0 mt-2 flex list-none flex-col gap-0.5 rounded-card border border-line bg-surface-solid p-2 elevation-pop';

/**
 * The floating top bar of the public site: search on the left, the logo in the centre, links with a
 * "Sign up" pill and "Sign in" on the right. Under 1024 px the links fold into a menu (a
 * `<details>`, so it works without JavaScript).
 */
export async function ShowcaseTopBar({ name }: { name?: string }) {
  const t = await getTranslations('showcase');
  const locale = await getLocale();
  const access = await dashboardAccess();
  const signedIn = access.kind !== 'anonymous' || Boolean(await currentGuestSession(null));
  const solutions = SOLUTION_KEYS.map((k) => ({ key: k, label: t(`solutions.${k}.name`) }));
  return (
    <>
      <IncidentBanner variant="site" />
      <div className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
        <header className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-pill border border-line bg-canvas/85 p-2 ps-2 sm:gap-3 sm:ps-3 backdrop-blur-xl">
          <search className="min-w-0">
            <form
              action={localizedPath(locale, '/events')}
              method="get"
              className="relative hidden max-w-[260px] md:block"
            >
              <label htmlFor="top-search" className="sr-only">
                {t('searchLabel')}
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2"
              />
              <input
                id="top-search"
                name="q"
                type="search"
                maxLength={100}
                placeholder={t('searchPlaceholder')}
                className="min-h-10 w-full rounded-pill border border-line bg-surface ps-10 pe-4 text-body text-ink placeholder:text-ink-3"
              />
            </form>
            <Link
              href="/events"
              aria-label={t('searchLabel')}
              className="inline-flex size-10 items-center justify-center rounded-pill border border-line bg-surface md:hidden"
            >
              <Search aria-hidden="true" className="size-4" />
            </Link>
          </search>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-pill px-2 font-display text-[18px] font-black tracking-[-0.03em] text-ink uppercase"
          >
            {name ? null : <BrandMark className="size-7" />}
            {name ?? t('wordmark')}
          </Link>
          <div className="flex items-center justify-end gap-1">
            <nav aria-label={t('siteNav')} className="hidden items-center lg:flex">
              <Link href="/events" className={link}>
                {t('events')}
              </Link>
              <details className="relative">
                <summary className={summary}>{t('solutionsLabel')}</summary>
                <ul className={`${popover} w-56`}>
                  {solutions.map((s) => (
                    <li key={s.key}>
                      <Link href={`/solutions/${s.key}`} className={`${link} w-full`}>
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
              <Link href="/pricing" className={link}>
                {t('pricing')}
              </Link>
              <Link href="/my-tickets" className={link}>
                {t('myTickets')}
              </Link>
            </nav>
            {signedIn ? (
              <Link href={access.href} className={cx(buttonClass('ember', 'md'), 'hidden sm:inline-flex')}>
                {t('dashboard')}
              </Link>
            ) : (
              <>
                <Link href="/sign-in?next=/attendee" className={`${link} hidden sm:inline-flex`}>
                  {t('signIn')}
                </Link>
                <Link href="/sign-up" className={cx(buttonClass('ember', 'md'), 'hidden sm:inline-flex')}>
                  {t('signUp')}
                </Link>
              </>
            )}
            <details className="relative lg:hidden">
              <summary
                aria-label={t('menu')}
                className="inline-flex size-10 cursor-pointer list-none items-center justify-center rounded-pill border border-line bg-surface [&::-webkit-details-marker]:hidden"
              >
                <Menu aria-hidden="true" className="size-5" />
              </summary>
              <ul className={`${popover} w-64`}>
                <li>
                  <Link href="/events" className={`${link} w-full`}>
                    {t('events')}
                  </Link>
                </li>
                {solutions.map((s) => (
                  <li key={s.key}>
                    <Link href={`/solutions/${s.key}`} className={`${link} w-full`}>
                      {s.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/pricing" className={`${link} w-full`}>
                    {t('pricing')}
                  </Link>
                </li>
                <li>
                  <Link href="/my-tickets" className={`${link} w-full`}>
                    {t('myTickets')}
                  </Link>
                </li>
                {signedIn ? (
                  <li>
                    <Link href={access.href} className={`${link} w-full`}>
                      {t('dashboard')}
                    </Link>
                  </li>
                ) : (
                  <>
                    <li>
                      <Link href="/sign-in?next=/attendee" className={`${link} w-full`}>
                        {t('signIn')}
                      </Link>
                    </li>
                    <li>
                      <Link href="/sign-up" className={cx(buttonClass('ember', 'md'), 'mt-1 w-full')}>
                        {t('signUp')}
                      </Link>
                    </li>
                  </>
                )}
              </ul>
            </details>
          </div>
        </header>
      </div>
    </>
  );
}
