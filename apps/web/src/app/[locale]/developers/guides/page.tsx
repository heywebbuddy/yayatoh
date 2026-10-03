import { PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { GUIDES } from '@/lib/developer-guides.ts';

export default async function GuidesIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('developers');
  return (
    <>
      <PageHeader title={t('nav.guides')} description={t('guidesSubtitle')} />
      <ul className="flex flex-col gap-2">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Link
              href={`/developers/guides/${g.slug}`}
              className="flex min-h-11 flex-col rounded-card border border-line bg-surface-solid px-4 py-3 hover:bg-surface-2"
            >
              <span lang="en" className="text-body font-medium">
                {g.title}
              </span>
              <span lang="en" className="text-caption text-ink-2">
                {g.summary.replaceAll('`', '')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
