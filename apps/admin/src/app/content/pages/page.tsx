import { Card, PageHeader, StatusPill } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { listPages } from '@/server/platform-site.ts';
import { requireStaff } from '@/server/staff.ts';
import { ContentTabs } from '../tabs.tsx';

/** Legal and static pages (privacy, terms, cookies, sub-processors, …). */
export default async function PagesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await requireStaff('content');
  const sp = await searchParams;
  const t = await getTranslations('platformContent');
  const pages = await listPages(staff.actor);
  return (
    <Shell staff={staff}>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/content/pages/new" className="text-body underline underline-offset-4">
            {t('pages.new')}
          </Link>
        }
      />
      <ContentTabs active="pages" done={sp.done} error={sp.error} />
      <Card size="panel" className="flex flex-col gap-3">
        <p className="m-0 text-body text-ink-2">{t('pages.intro')}</p>
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {pages.map((p) => (
            <li
              key={`${p.slug}-${p.locale}`}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/content/pages/${p.slug}?locale=${p.locale}`}
                  className="text-body font-bold underline underline-offset-4"
                >
                  {p.title}
                </Link>
                <span className="text-caption text-ink-2">
                  {t('pages.meta', {
                    path: `/${p.slug}`,
                    language: p.locale,
                    version: p.version,
                    date: p.effectiveDate,
                  })}
                </span>
              </div>
              <StatusPill
                tone={p.status === 'published' ? 'success' : 'neutral'}
                label={t(`pages.status.${p.status}`)}
              />
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
