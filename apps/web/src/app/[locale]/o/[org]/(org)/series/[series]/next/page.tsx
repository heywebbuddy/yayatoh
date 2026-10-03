import { utcToZonedInput } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NextEventForm } from '@/components/series-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { suggestNextEdition } from '@/lib/series-next.ts';
import { createNextEventAction } from '../actions.ts';
import { loadSeries } from '../data.ts';

/** U7: "Create next event in series" — a draft copy of the latest event's setup, in the series. */
export default async function NextInSeriesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; series: string }>;
}) {
  const { locale, org, series: slug } = await params;
  setRequestLocale(locale);
  const { data, series } = await loadSeries(org, slug);
  if (!roleCan(data.role, 'events:write')) notFound();
  const t = await getTranslations();
  const base = `/o/${org}/series/${series.slug}`;
  const latest = series.events.at(-1);
  const suggestion = suggestNextEdition(series.events, new Date());
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={base} className="text-caption text-ink-2 underline underline-offset-2">
            {t('seriesPage.next.back', { name: series.name })}
          </Link>
        }
        title={t('seriesPage.next.title')}
        description={t('seriesPage.next.description', { name: series.name })}
      />
      {latest && suggestion ? (
        <Card size="panel" className="flex max-w-2xl flex-col gap-4">
          <p className="m-0 text-body text-ink-2">
            {t('seriesPage.next.copies', {
              name: latest.name,
              when: formatEventDateRange(latest.startsAt.toISOString(), latest.endsAt.toISOString(), {
                locale,
                currency: latest.currency,
                timeZone: latest.timezone,
              }),
            })}
          </p>
          <NextEventForm
            action={createNextEventAction.bind(null, org, series.slug)}
            defaults={{
              name: suggestion.name,
              startsAt: utcToZonedInput(suggestion.startsAt, latest.timezone),
            }}
            timeZone={latest.timezone}
          />
        </Card>
      ) : (
        <EmptyState
          title={t('seriesPage.emptyTitle')}
          description={t('seriesPage.emptyDescription')}
          action={
            <Link href={`/o/${org}/events/new?series=${series.id}`} className={buttonClass('primary')}>
              {t('seriesPage.createIn')}
            </Link>
          }
        />
      )}
    </>
  );
}
