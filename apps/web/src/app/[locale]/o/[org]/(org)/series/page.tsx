import { listEventsQuery, listSeriesQuery, type SeriesDto } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { SeriesForm } from '@/components/series-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createSeriesAction, deleteSeriesAction } from './actions.ts';

/** M1.4b: the org's series (tours, seasons) with their public pages. */
export default async function SeriesPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const canWrite = roleCan(data.role, 'events:write');
  const [series, events] = await Promise.all([
    executeQuery(listSeriesQuery, {}, data.ctx, ports),
    executeQuery(listEventsQuery, {}, data.ctx, ports),
  ]);
  const names = new Map(events.map((e) => [e.id, e.name]));
  return (
    <>
      <PageHeader
        title={t('series.title')}
        description={t('series.description')}
        actions={
          canWrite ? (
            <Link href={`/o/${org}/series#new-series`} className={buttonClass('primary', 'md')}>
              {t('series.new')}
            </Link>
          ) : null
        }
      />
      <HowItWorks topic="series" />
      {series.length === 0 ? (
        <EmptyState
          title={t('series.emptyTitle')}
          description={t('series.emptyDescription')}
          action={
            canWrite ? (
              <Link href={`/o/${org}/series#new-series`} className={buttonClass('secondary', 'md')}>
                {t('series.startFirst')}
              </Link>
            ) : (
              <Link href={`/o/${org}`} className={buttonClass('secondary', 'md')}>
                {t('emptyActions.seeEvents')}
              </Link>
            )
          }
        />
      ) : (
        <Table
          caption={t('series.caption')}
          rowKey={(r) => r.id}
          rows={series}
          columns={[
            {
              key: 'name',
              header: t('series.name'),
              cell: (r) => (
                <span className="flex flex-col">
                  <span>{r.name}</span>
                  {r.description ? <span className="text-caption text-ink-2">{r.description}</span> : null}
                </span>
              ),
            },
            {
              key: 'events',
              header: t('series.events'),
              cell: (r) => (
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono">{formatNumber(r.eventIds.length, locale)}</span>
                  <span className="text-caption text-ink-2">
                    {r.eventIds
                      .map((id) => names.get(id))
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </span>
              ),
            },
            {
              key: 'links',
              header: t('series.links'),
              cell: (r) => (
                <span className="flex flex-wrap gap-1">
                  <Link href={`/series/${r.slug}`} className={buttonClass('ghost', 'sm')}>
                    {t('series.publicPage')}
                  </Link>
                  <Link href={`/o/${org}?series=${r.slug}`} className={buttonClass('ghost', 'sm')}>
                    {t('series.showEvents')}
                  </Link>
                </span>
              ),
            },
            ...(canWrite
              ? [
                  {
                    key: 'actions',
                    header: t('series.actions'),
                    align: 'end' as const,
                    cell: (r: SeriesDto) => (
                      <form action={deleteSeriesAction.bind(null, org, r.id)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t('series.deleteFor', { name: r.name })}
                        >
                          {t('series.delete')}
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {canWrite ? (
        <section
          id="new-series"
          aria-labelledby="new-series-heading"
          className="flex scroll-mt-6 flex-col gap-3"
        >
          <h2 id="new-series-heading" className="text-section">
            {t('series.new')}
          </h2>
          <Card>
            <SeriesForm action={createSeriesAction.bind(null, org)} />
          </Card>
        </section>
      ) : null}
    </>
  );
}
