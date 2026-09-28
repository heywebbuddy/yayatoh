import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicSpeakerView } from '@/components/public-speaker-view.tsx';
import { pageLocale } from '@/server/locale.ts';

type Params = { params: Promise<{ locale: string; slug: string; speaker: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'publicEvent' });
  return { title: t('speakerPageTitle') };
}

/** A speaker's public page (M1.4f). */
export default async function SpeakerPage({ params }: Params) {
  const { locale, slug, speaker } = await params;
  pageLocale(locale);
  return <PublicSpeakerView locale={locale} slug={slug} speakerId={speaker} />;
}
