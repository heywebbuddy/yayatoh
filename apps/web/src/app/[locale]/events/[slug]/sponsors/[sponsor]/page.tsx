import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicSponsorView } from '@/components/public-sponsor-view.tsx';
import { pageLocale } from '@/server/locale.ts';

type Params = { params: Promise<{ locale: string; slug: string; sponsor: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'publicEvent' });
  return { title: t('sponsorPageTitle') };
}

/** A sponsor's public page. */
export default async function SponsorPage({ params }: Params) {
  const { locale, slug, sponsor } = await params;
  pageLocale(locale);
  return <PublicSponsorView slug={slug} sponsorId={sponsor} />;
}
