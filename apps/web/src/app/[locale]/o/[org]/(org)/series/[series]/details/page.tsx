import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeriesDetailsForm } from '@/components/series-forms.tsx';
import { SeriesTabs } from '@/components/series-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { deleteSeriesFromPageAction, updateSeriesDetailsAction } from '../actions.ts';
import { loadSeries } from '../data.ts';

/** U7: a series' Details tab — its name, description and public address; delete. */
export default async function SeriesDetailsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; series: string }>;
}) {
  const { locale, org, series: slug } = await params;
  setRequestLocale(locale);
  const { data, series } = await loadSeries(org, slug);
  const t = await getTranslations();
  const canWrite = roleCan(data.role, 'events:write');
  const base = `/o/${org}/series/${series.slug}`;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/series`} className="text-caption text-ink-2 underline underline-offset-2">
            {t('seriesPage.back')}
          </Link>
        }
        title={series.name}
        description={series.description ?? undefined}
      />
      <SeriesTabs base={base} active="details" />
      <section aria-labelledby="series-details-heading" className="flex flex-col gap-3">
        <h2 id="series-details-heading" className="text-section">
          {t('seriesPage.details.heading')}
        </h2>
        <Card className="flex flex-col gap-4">
          <p className="m-0 text-body text-ink-2">
            {t('seriesPage.details.address')}{' '}
            <Link href={`/series/${series.slug}`} className="font-mono underline underline-offset-2">
              /series/{series.slug}
            </Link>
          </p>
          {canWrite ? (
            <SeriesDetailsForm
              action={updateSeriesDetailsAction.bind(null, org, series.slug)}
              defaults={{ name: series.name, description: series.description }}
            />
          ) : (
            <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 text-body sm:grid-cols-[max-content_1fr]">
              <dt className="text-caption text-ink-2">{t('series.name')}</dt>
              <dd className="m-0">{series.name}</dd>
              <dt className="text-caption text-ink-2">{t('series.descriptionField')}</dt>
              <dd className="m-0">{series.description ?? '—'}</dd>
            </dl>
          )}
        </Card>
      </section>
      {canWrite ? (
        <section aria-labelledby="series-delete-heading" className="flex flex-col gap-3">
          <h2 id="series-delete-heading" className="text-section">
            {t('seriesPage.details.deleteHeading')}
          </h2>
          <Card className="flex flex-col gap-3">
            <p className="m-0 text-body text-ink-2">{t('seriesPage.details.deleteHint')}</p>
            <form action={deleteSeriesFromPageAction.bind(null, org, series.slug)}>
              <Button type="submit" variant="secondary">
                {t('seriesPage.details.delete')}
              </Button>
            </form>
          </Card>
        </section>
      ) : null}
    </>
  );
}
