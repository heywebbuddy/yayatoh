import { publicSeriesBySlug } from '@yayatoh/events';
import { buttonClass, Card, EmptyState, Label } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
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
    <div className="min-h-dvh bg-page">
      <SiteHeader />
      <main
        id="main"
        className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8 [overflow-wrap:anywhere]"
      >
        <section className="relative isolate overflow-hidden rounded-[32px] bg-hero px-6 py-12 text-white elevation-card md:px-10 md:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -end-12 -top-24 -z-10 size-80 rounded-full bg-white/20 blur-3xl"
          />
          <div className="relative flex max-w-3xl flex-col gap-3">
            <Label>{t('publicSeries.eyebrow', { org: series.organizerName })}</Label>
            <h1 className="m-0 text-[38px] leading-[1.04] font-extrabold tracking-[-0.045em] md:text-[56px]">
              {series.name}
            </h1>
            {series.description ? (
              <p className="m-0 max-w-2xl text-[16px] leading-relaxed text-white/85 md:text-[18px]">
                {series.description}
              </p>
            ) : null}
          </div>
        </section>
        <section aria-labelledby="upcoming-heading" className="flex flex-col gap-4">
          <h2 id="upcoming-heading" className="text-section">
            {t('publicSeries.upcoming')}
          </h2>
          {series.events.length === 0 ? (
            <EmptyState
              title={t('publicSeries.emptyTitle')}
              description={t('publicSeries.emptyDescription')}
            />
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2">
              {series.events.map((e) => (
                <li key={e.slug}>
                  <Card interactive className="flex h-full flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <h3 className="m-0 text-card font-extrabold tracking-[-0.02em]">{e.name}</h3>
                      <p className="m-0 text-body text-ink-2">
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
                      className={buttonClass('secondary', 'sm', 'self-start')}
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
      <SiteFooter />
    </div>
  );
}
