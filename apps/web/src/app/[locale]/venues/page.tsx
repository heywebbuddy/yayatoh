import { Card, EmptyState } from '@yayatoh/ui';
import { venueDirectory } from '@yayatoh/venues';
import { ArrowUpRight, Building2, MapPin, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { venueDisplayName } from '@/lib/venue-display.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'directory' });
  return { title: t('title'), description: t('subtitle') };
}

/** The platform venue directory (M1.4c): listed venues of live orgs. */
export default async function VenueDirectoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Live data: render per request, never at build time.
  await connection();
  const t = await getTranslations('directory');
  const tMeta = await getTranslations('meta');
  const venues = await venueDirectory();
  const region = new Intl.DisplayNames([locale], { type: 'region' });
  return (
    <div className="min-h-dvh bg-page">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
        <section className="relative isolate overflow-hidden rounded-[32px] bg-hero px-6 py-12 text-white elevation-card md:px-10 md:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -end-12 -top-24 -z-10 size-80 rounded-full bg-white/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute end-24 -bottom-36 -z-10 h-64 w-80 rotate-12 rounded-[56px] border border-white/25 bg-white/10"
          />
          <div className="relative flex max-w-3xl flex-col gap-3">
            <span className="text-label font-bold uppercase tracking-[0.12em] text-white/75">
              {tMeta('title')}
            </span>
            <h1 className="m-0 text-[38px] leading-[1.04] font-extrabold tracking-[-0.045em] md:text-[56px]">
              {t('title')}
            </h1>
            <p className="m-0 max-w-2xl text-[16px] leading-relaxed text-white/85 md:text-[18px]">
              {t('subtitle')}
            </p>
          </div>
        </section>
        {venues.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <section aria-label={t('title')}>
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {venues.map((v) => {
                const place = [v.city, v.region, region.of(v.country) ?? v.country]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <li key={v.slug}>
                    <Card interactive className="group flex h-full min-h-48 flex-col gap-5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-primary-soft text-primary-ink">
                          <Building2 aria-hidden="true" className="size-5" />
                        </span>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 text-ink-2 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-2">
                        <h2 className="m-0 text-card font-extrabold tracking-[-0.02em]">
                          <Link
                            href={`/venues/${v.slug}`}
                            className="rounded-control underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                          >
                            {venueDisplayName(v.name)}
                            <span className="sr-only"> — {t('title')}</span>
                          </Link>
                        </h2>
                        {place ? (
                          <p className="m-0 flex items-start gap-2 text-body text-ink-2">
                            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                            <span>{place}</span>
                          </p>
                        ) : null}
                      </div>
                      {v.capacity ? (
                        <span className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-pill border border-line bg-surface-2 px-3 text-caption font-semibold text-ink-2">
                          <UsersRound aria-hidden="true" className="size-3.5" />
                          {t('capacity', {
                            count: v.capacity,
                            formatted: formatNumber(v.capacity, locale),
                          })}
                        </span>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
