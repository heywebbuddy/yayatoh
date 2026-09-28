import {
  CMS_WRITE,
  type ContactRequestDto,
  listContactRequestsQuery,
  listSiteSectionsQuery,
  SITE_PLACEMENTS,
  type SiteSectionDto,
} from '@yayatoh/cms';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { isPlatformContentOrg } from '@/server/cms.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { markHandledAction } from './actions.ts';

const DOT = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

/** M3.11b: the marketing site's sections (home, features, contact) and the contact requests. */
export default async function MarketingConsole({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ tab?: string; deleted?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  if (!isPlatformContentOrg(org)) notFound();
  const sp = await searchParams;
  const data = await loadConsole(org);
  const canWrite = roleCan(data.role, CMS_WRITE);
  // Contact requests hold personal data: only the roles that write the site see them.
  const tab = sp.tab === 'requests' && canWrite ? 'requests' : 'sections';
  const t = await getTranslations('siteConsole');
  const tc = await getTranslations('cms');
  const f = { locale, currency: data.org.currency, timeZone: data.org.timezone };
  const localeName = (l: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(l) ?? l;
  const tabLink = (k: 'sections' | 'requests') => (
    <Link
      href={`/o/${org}/marketing${k === 'requests' ? '?tab=requests' : ''}`}
      aria-current={tab === k ? 'page' : undefined}
      className={buttonClass(tab === k ? 'primary' : 'secondary', 'sm')}
    >
      {t(`tabs.${k}`)}
    </Link>
  );
  const sections = tab === 'sections' ? await executeQuery(listSiteSectionsQuery, {}, data.ctx, ports) : [];
  const requests =
    tab === 'requests' ? await executeQuery(listContactRequestsQuery, {}, data.ctx, ports) : [];
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite && tab === 'sections' ? (
            <Link href={`/o/${org}/marketing/new`} className={buttonClass('primary')}>
              {t('newSection')}
            </Link>
          ) : null
        }
      />
      {canWrite ? null : (
        <p
          role="note"
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body text-zinc-600"
        >
          {tc('readOnly')}
        </p>
      )}
      {sp.deleted ? <Alert tone="info" title={tc('deleted')} /> : null}
      {canWrite ? (
        <nav aria-label={t('tabsLabel')} className="flex gap-2">
          {tabLink('sections')}
          {tabLink('requests')}
        </nav>
      ) : null}
      {tab === 'sections'
        ? SITE_PLACEMENTS.map((p) => {
            const rows = sections.filter((s) => s.placement === p);
            return (
              <section key={p} aria-labelledby={`placement-${p}`} className="flex flex-col gap-3">
                <h2 id={`placement-${p}`} className="text-[19px] font-normal">
                  {t(`placement.${p}`)}
                </h2>
                {rows.length === 0 ? (
                  <p className="text-body text-zinc-600">{t('noSections')}</p>
                ) : (
                  <Table
                    caption={t(`placement.${p}`)}
                    rowKey={(r) => r.id}
                    rows={rows}
                    columns={[
                      {
                        key: 'heading',
                        header: t('fields.heading'),
                        cell: (r: SiteSectionDto) => (
                          <span className="flex flex-col">
                            <Link
                              href={`/o/${org}/marketing/${r.id}`}
                              className="underline underline-offset-2"
                            >
                              {r.heading}
                            </Link>
                            <span className="text-caption text-zinc-500">
                              <span dir="ltr" className="font-mono">
                                {r.slug}
                              </span>{' '}
                              · {localeName(r.locale)}
                            </span>
                          </span>
                        ),
                      },
                      {
                        key: 'status',
                        header: tc('columns.status'),
                        cell: (r: SiteSectionDto) => (
                          <StatusDot status={DOT[r.status]} label={tc(`status.${r.status}`)} />
                        ),
                      },
                      {
                        key: 'position',
                        header: t('fields.position'),
                        mono: true,
                        align: 'end',
                        cell: (r: SiteSectionDto) => String(r.position),
                      },
                    ]}
                  />
                )}
              </section>
            );
          })
        : null}
      {tab === 'requests' ? (
        requests.length === 0 ? (
          <EmptyState title={t('noRequestsTitle')} description={t('noRequestsDescription')} />
        ) : (
          <ul aria-label={t('tabs.requests')} className="flex list-none flex-col gap-3 p-0">
            {requests.map((r: ContactRequestDto) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-card border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body font-medium break-words">
                    {r.name}
                    {r.company ? ` · ${r.company}` : ''}
                  </p>
                  <StatusDot
                    status={r.status === 'new' ? 'warning' : 'success'}
                    label={t(`requestStatus.${r.status}`)}
                  />
                </div>
                <p className="text-caption text-zinc-500">
                  {t(`topics.${r.topic}`)} ·{' '}
                  <a href={`mailto:${r.email}`} dir="ltr" className="underline">
                    {r.email}
                  </a>{' '}
                  ·{' '}
                  {formatDate(r.createdAt.toISOString(), f, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-body break-words whitespace-pre-line">{r.message}</p>
                {r.status === 'new' ? (
                  <form action={markHandledAction.bind(null, org, r.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      {t('markHandled')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
