import { type OrgOverviewDto, orgOverviewQuery } from '@yayatoh/command-center';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { buttonClass, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { commandCenterCtx } from '@/server/command-center.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const DOT = { planning: 'neutral', pre_show: 'warning', live: 'success', wrap: 'info' } as const;

/**
 * The multi-event Command Center overview (M3.2a): the org's events that are live, in pre-show,
 * being planned or wrapping up, live first; each opens its own Command Center. No money here.
 */
export default async function CommandCenterOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('commandCenter');
  let overview: OrgOverviewDto;
  try {
    overview = await executeQuery(orgOverviewQuery, {}, await commandCenterCtx(data.ctx), ports);
  } catch (err) {
    if (!isDomainError(err) || err.code !== 'forbidden') throw err;
    return (
      <>
        <PageHeader title={t('overviewTitle')} />
        <EmptyState
          title={t('noAccess.title')}
          description={t('noAccess.description')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {t('noAccess.action')}
            </Link>
          }
        />
      </>
    );
  }
  const when = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  return (
    <>
      <PageHeader title={t('overviewTitle')} description={t('overviewDescription')} />
      {overview.total > overview.events.length ? (
        <p className="text-caption text-ink-2">
          {t('overviewTruncated', { shown: overview.events.length, total: overview.total })}
        </p>
      ) : null}
      {overview.events.length === 0 ? (
        <EmptyState
          title={t('overviewEmpty.title')}
          description={t('overviewEmpty.description')}
          action={
            <Link href={`/o/${org}`} className={buttonClass('primary', 'md')}>
              {t('overviewEmpty.action')}
            </Link>
          }
        />
      ) : (
        <Table
          caption={t('overviewTitle')}
          rowKey={(e) => e.eventId}
          rows={overview.events}
          columns={[
            {
              key: 'event',
              header: t('columns.event'),
              cell: (e) => (
                <Link
                  href={`/o/${org}/e/${e.slug}/command-center`}
                  className="inline-flex min-h-6 items-center font-medium underline underline-offset-2"
                >
                  {e.name}
                </Link>
              ),
            },
            {
              key: 'mode',
              header: t('columns.mode'),
              cell: (e) => (
                <span className="inline-flex flex-wrap items-center gap-2" data-testid="cc-overview-mode">
                  <StatusDot status={DOT[e.mode]} label={t(`mode.${e.mode}`)} live={e.mode === 'live'} />
                  {e.overridden ? <span className="text-caption text-ink-2">{t('manual')}</span> : null}
                </span>
              ),
            },
            { key: 'starts', header: t('columns.starts'), cell: (e) => when(e.startsAt, e.timeZone) },
            {
              key: 'readiness',
              header: t('columns.readiness'),
              cell: (e) =>
                e.readiness === null
                  ? '—'
                  : new Intl.NumberFormat(locale, { style: 'percent' }).format(e.readiness / 100),
            },
          ]}
        />
      )}
    </>
  );
}
