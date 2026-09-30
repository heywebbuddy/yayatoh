import { Card, EmptyState } from '@yayatoh/ui';
import { venueDirectory } from '@yayatoh/venues';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';

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
  const venues = await venueDirectory();
  const region = new Intl.DisplayNames([locale], { type: 'region' });
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-12 md:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[36px] leading-tight font-light tracking-[-0.04em] md:text-title">
          {t('title')}
        </h1>
        <p className="text-[15px] text-zinc-500">{t('subtitle')}</p>
      </header>
      {venues.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3">
          {venues.map((v) => (
            <li key={v.slug}>
              <Card className="flex h-full flex-col gap-2">
                <h2 className="text-[20px] font-light tracking-[-0.02em]">
                  <Link href={`/venues/${v.slug}`} className="underline-offset-2 hover:underline">
                    {v.name}
                  </Link>
                </h2>
                <p className="text-body text-zinc-500">
                  {[v.city, v.region, region.of(v.country) ?? v.country].filter(Boolean).join(', ')}
                </p>
                {v.capacity ? (
                  <p className="text-caption text-zinc-600">
                    {t('capacity', { count: v.capacity, formatted: formatNumber(v.capacity, locale) })}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
