import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicExhibitorMapView } from '@/components/public-exhibitor-map.tsx';
import { pageLocale } from '@/server/locale.ts';

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'exhibitorMap' });
  return { title: t('pageTitle') };
}

/** The public exhibitor map (M5.4a): booths on the floor plan and an accessible list. */
export default async function ExhibitorMapPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  return <PublicExhibitorMapView slug={slug} />;
}
