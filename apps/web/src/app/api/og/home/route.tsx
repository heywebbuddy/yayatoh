import { getTranslations } from 'next-intl/server';
import { ogImage } from '@/server/og.tsx';

/** The marketplace's share image. */
export async function GET() {
  const t = await getTranslations({ locale: 'en', namespace: 'market' });
  return ogImage({
    eyebrow: t('home.eyebrow'),
    title: t('home.title'),
    lines: [t('home.lede')],
    footer: t('wordmark'),
    brandColor: null,
  });
}
