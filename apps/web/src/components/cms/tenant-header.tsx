import type { PublicOrganizer } from '@yayatoh/marketplace';
import { getLocale, getTranslations } from 'next-intl/server';
import { TenantAccount } from '@/components/tenant-account.tsx';
import { ThemeSwitch } from '@/components/theme-switch.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedEntries, cachedNavPages, entryPath } from '@/server/cms.ts';
import { currentTheme } from '@/server/theme.ts';

const linkClass =
  'inline-flex min-h-10 items-center rounded-[10px] px-3 font-bold text-ink-2 hover:bg-surface-3 hover:text-ink aria-[current=page]:bg-surface-3 aria-[current=page]:text-ink';

/**
 * A tenant site's header (M1.11a + M1.4g): the org's name (home), its blog when it has posts,
 * the pages the organizer linked in the public site settings, in their order, and the account
 * corner (M1.2d: sign in through the app host, this host's own session).
 */
export async function TenantHeader({ org, current }: { org: PublicOrganizer; current?: string }) {
  const t = await getTranslations('cmsPublic');
  const [nav, posts, locale, theme] = await Promise.all([
    cachedNavPages(org.orgId),
    cachedEntries(org.orgId, 'post', 1),
    getLocale(),
    currentTheme(),
  ]);
  const links = [
    ...(posts.items.length > 0 ? [{ href: '/blogs', label: t('blog') }] : []),
    ...nav.map((p) => ({ href: entryPath('page', p.slug), label: p.title })),
  ];
  return (
    <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-5 sm:pt-5">
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[22px] border border-line bg-surface p-2.5 ps-4 elevation-card glass">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center gap-2.5 rounded-control text-[17px] font-extrabold tracking-[-0.02em] text-ink"
        >
          <span
            aria-hidden="true"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-brand-strong text-[13px] font-extrabold text-white"
          >
            {org.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? '')
              .join('')}
          </span>
          {org.name}
        </Link>
        {links.length > 0 ? (
          <nav aria-label={t('siteNav', { org: org.name })}>
            <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-body">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={current === l.href ? 'page' : undefined}
                    className={linkClass}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="flex items-center gap-2">
          <ThemeSwitch initial={theme} />
          <TenantAccount locale={locale} path={current ?? '/'} orgId={org.orgId} />
        </div>
      </header>
    </div>
  );
}
