import { publicSeriesBySlug } from '@yayatoh/events';
import { buttonClass, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';

/** M1.4b: a public series page — its upcoming public events, each in its own timezone. */
export default async function PublicSeriesPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const series = await publicSeriesBySlug(slug);
  if (!series) notFound();
  const t = await getTranslations();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('publicSeries.eyebrow', { org: series.organizerName })}</Label>}
        title={series.name}
        description={series.description ?? undefined}
      />
      <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
        <h2 id="upcoming-heading" className="text-section">
          {t('publicSeries.upcoming')}
        </h2>
        {series.events.length === 0 ? (
          <EmptyState title={t('publicSeries.emptyTitle')} description={t('publicSeries.emptyDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {series.events.map((e) => (
              <li key={e.slug}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-[20px] font-light tracking-[-0.02em]">{e.name}</h3>
                    <p className="text-body text-zinc-600">
                      {[
                        formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
                          locale,
                          currency: 'USD',
                          timeZone: e.timezone,
                        }),
                        e.venueName,
                        e.city,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Link
                    href={`/events/${e.slug}`}
                    className={buttonClass('secondary')}
                    aria-label={t('publicSeries.viewEvent', { name: e.name })}
                  >
                    {t('publicSeries.view')}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
