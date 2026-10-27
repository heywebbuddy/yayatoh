import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicExhibitorView } from '@/components/public-exhibitor-view.tsx';
import { pageLocale } from '@/server/locale.ts';

type Params = { params: Promise<{ locale: string; slug: string; exhibitor: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'publicEvent' });
  return { title: t('exhibitorPageTitle') };
}

/** A exhibitor's public page. */
export default async function ExhibitorPage({ params }: Params) {
  const { locale, slug, exhibitor } = await params;
  pageLocale(locale);
  return <PublicExhibitorView slug={slug} exhibitorId={exhibitor} />;
}
