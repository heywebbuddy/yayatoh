import type { PublicOrganizer } from '@yayatoh/marketplace';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { cachedEntries, cachedNavPages, entryPath } from '@/server/cms.ts';

const linkClass = 'inline-flex min-h-10 items-center underline-offset-4 hover:underline';

/**
 * A tenant site's header (M1.11a + M1.4g): the org's name (home), its blog when it has posts,
 * and the pages the organizer linked in the public site settings, in their order.
 */
export async function TenantHeader({ org, current }: { org: PublicOrganizer; current?: string }) {
  const t = await getTranslations('cmsPublic');
  const [nav, posts] = await Promise.all([cachedNavPages(org.orgId), cachedEntries(org.orgId, 'post', 1)]);
  const links = [
    ...(posts.items.length > 0 ? [{ href: '/blogs', label: t('blog') }] : []),
    ...nav.map((p) => ({ href: entryPath('page', p.slug), label: p.title })),
  ];
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
      <Link
        href="/"
        className="inline-flex min-h-10 items-center text-[19px] font-semibold tracking-[-0.04em]"
      >
        {org.name}
      </Link>
      {links.length > 0 ? (
        <nav aria-label={t('siteNav', { org: org.name })}>
          <ul className="flex list-none flex-wrap items-center gap-4 p-0 text-body">
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
    </header>
  );
}
