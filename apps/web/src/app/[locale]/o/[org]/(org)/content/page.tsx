import { CMS_WRITE, type EntryDto, listEntriesQuery } from '@yayatoh/cms';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, buttonClass, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const DOT = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

/** M1.4g: the org's pages and blog posts (tenant CMS). */
export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ kind?: string; deleted?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const kind = sp.kind === 'page' ? 'page' : 'post';
  const data = await loadConsole(org);
  const t = await getTranslations('cms');
  const canWrite = roleCan(data.role, CMS_WRITE);
  const rows = await executeQuery(listEntriesQuery, { kind }, data.ctx, ports);
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const tab = (k: 'post' | 'page') => (
    <Link
      href={`/o/${org}/content?kind=${k}`}
      aria-current={kind === k ? 'page' : undefined}
      className={buttonClass(kind === k ? 'primary' : 'secondary', 'sm')}
    >
      {t(`tabs.${k}`)}
    </Link>
  );
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite ? (
            <Link href={`/o/${org}/content/new?kind=${kind}`} className={buttonClass('primary')}>
              {t(kind === 'page' ? 'newPage' : 'newPost')}
            </Link>
          ) : null
        }
      />
      {canWrite ? null : (
        <p role="note" className="rounded-card border border-line bg-surface px-4 py-3 text-body text-ink-2">
          {t('readOnly')}
        </p>
      )}
      {sp.deleted ? <Alert tone="info" title={t('deleted')} /> : null}
      <nav aria-label={t('tabsLabel')} className="flex gap-2">
        {tab('post')}
        {tab('page')}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          title={t(kind === 'page' ? 'emptyPagesTitle' : 'emptyPostsTitle')}
          description={t(canWrite ? 'emptyDescription' : 'emptyDescriptionViewer')}
          action={
            canWrite ? (
              <Link href={`/o/${org}/content/new?kind=${kind}`} className={buttonClass('secondary', 'md')}>
                {t(kind === 'page' ? 'emptyActionPage' : 'emptyActionPost')}
              </Link>
            ) : (
              <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
                {t('findOwner')}
              </Link>
            )
          }
        />
      ) : (
        <Table
          caption={t(`tabs.${kind}`)}
          rowKey={(r) => r.id}
          rows={rows}
          columns={[
            {
              key: 'title',
              header: t('columns.title'),
              cell: (r: EntryDto) => (
                <span className="flex flex-col">
                  <Link href={`/o/${org}/content/${r.id}`} className="underline underline-offset-2">
                    {r.title}
                  </Link>
                  <span dir="ltr" className="font-mono text-caption text-ink-2">
                    {kind === 'page' ? '/pages/' : '/blogs/'}
                    {r.slug}
                  </span>
                </span>
              ),
            },
            {
              key: 'status',
              header: t('columns.status'),
              cell: (r: EntryDto) => <StatusDot status={DOT[r.status]} label={t(`status.${r.status}`)} />,
            },
            {
              key: 'updated',
              header: t('columns.updated'),
              mono: true,
              align: 'end',
              cell: (r: EntryDto) =>
                formatDate(r.updatedAt.toISOString(), f, { year: 'numeric', month: 'short', day: 'numeric' }),
            },
          ]}
        />
      )}
    </>
  );
}
