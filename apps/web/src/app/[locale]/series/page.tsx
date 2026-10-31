import { publicSeriesDirectory } from '@yayatoh/events';
import { ArrowUpRight, Layers3 } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SiteFooter, SiteHeader } from '@/components/marketplace/site-chrome.tsx';
import { artGlow, GLOW } from '@/components/showcase/categories.ts';
import { Link } from '@/i18n/navigation.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'series' });
  return { title: t('title'), description: t('description') };
}

/** Public directory of series that currently have upcoming public events. */
export default async function SeriesDirectoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection();
  const [t, tPublic, tMarket, series] = await Promise.all([
    getTranslations('series'),
    getTranslations('publicSeries'),
    getTranslations('market'),
    publicSeriesDirectory(),
  ]);

  return (
    <div className="min-h-dvh bg-page">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
        <section className="relative isolate overflow-hidden rounded-[32px] bg-hero px-6 py-12 text-white elevation-card md:px-10 md:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -end-12 -top-24 -z-10 size-80 rounded-full bg-white/20 blur-3xl"
          />
          <div className="relative flex max-w-3xl flex-col gap-3">
            <span className="text-label font-bold uppercase tracking-[0.12em] text-white/75">
              {t('title')}
            </span>
            <h1 className="m-0 text-[38px] leading-[1.04] font-extrabold tracking-[-0.045em] md:text-[56px]">
              {t('title')}
            </h1>
            <p className="m-0 max-w-2xl text-[16px] leading-relaxed text-white/85 md:text-[18px]">
              {t('description')}
            </p>
          </div>
        </section>

        {series.length === 0 ? (
          <section className="rounded-[28px] border border-dashed border-line bg-surface px-6 py-14 text-center">
            <h2 className="m-0 text-section">{tPublic('emptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl text-body text-ink-2">{tPublic('emptyDescription')}</p>
            <Link
              href="/events"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 font-bold text-ink hover:bg-surface-2"
            >
              {tMarket('browse')}
            </Link>
          </section>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {series.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/series/${item.slug}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-[24px] border border-line bg-surface elevation-card transition hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                >
                  <div
                    aria-hidden="true"
                    className={`relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden bg-linear-to-br ${GLOW[artGlow(item.slug)].art}`}
                  >
                    <Layers3 className="size-16 text-white/55" strokeWidth={1.25} />
                    <span className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/35 to-transparent" />
                    <ArrowUpRight className="absolute end-3 top-3 size-5 text-white transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2 px-6 pt-5">
                    <h2 className="m-0 text-card font-extrabold tracking-[-0.02em]">{item.name}</h2>
                    <p className="m-0 text-body text-ink-2">
                      {item.description || tPublic('eyebrow', { org: item.organizerName })}
                    </p>
                  </div>
                  <span className="px-6 pt-3 pb-5 text-caption font-semibold text-ink-2">
                    {tMarket('by', { org: item.organizerName })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
