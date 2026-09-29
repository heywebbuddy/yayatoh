import { Card, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { loadEvent } from '@/server/console.ts';
import { mediaPanel } from '@/server/media.ts';

/** Event images (M1.4e): the cover (hero, listing card, link previews) and the gallery. */
export default async function EventMediaPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'media');
  const t = await getTranslations('eventMedia');
  const [cover, gallery] = await Promise.all([
    mediaPanel(data, 'event', ev.id, 'cover'),
    mediaPanel(data, 'event', ev.id, 'gallery'),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card size="panel">
        <MediaUploader org={org} slot="cover" ticket={cover.ticket} items={cover.items} />
      </Card>
      <Card size="panel">
        <MediaUploader org={org} slot="gallery" ticket={gallery.ticket} items={gallery.items} />
      </Card>
    </>
  );
}
