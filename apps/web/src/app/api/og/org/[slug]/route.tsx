import { publicOrganizer } from '@yayatoh/marketplace';
import { getTranslations } from 'next-intl/server';
import { ogImage } from '@/server/og.tsx';

/** An organizer's share image (tenant site home, /o/{slug}) in its brand colour. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const o = await publicOrganizer(slug);
  if (!o) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale: 'en', namespace: 'market' });
  return ogImage({
    eyebrow: t('organizer.eyebrow'),
    title: o.name,
    lines: [t('upcoming')],
    footer: t('wordmark'),
    brandColor: o.brandColor,
  });
}
