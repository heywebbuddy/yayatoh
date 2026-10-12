import { buttonClass, Card, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { mediaPanel } from '@/server/media.ts';

/** Event images (M1.4e): the cover (hero, listing card, link previews) and the gallery. */
export default async function EventMediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'media');
  const [t, tn] = await Promise.all([getTranslations('eventMedia'), getTranslations()]);
  const [cover, gallery] = await Promise.all([
    mediaPanel(data, 'event', ev.id, 'cover'),
    mediaPanel(data, 'event', ev.id, 'gallery'),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {sp.created === '1' ? (
        <Card size="panel" className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-body">{tn('newEvent.description')}</p>
          <Link href={`/o/${org}/e/${event}/setup-guide`} className={buttonClass('secondary')}>
            {tn('setupGuide.open')}
          </Link>
        </Card>
      ) : null}
      <Card size="panel">
        <MediaUploader org={org} slot="cover" ticket={cover.ticket} items={cover.items} />
      </Card>
      <Card size="panel">
        <MediaUploader org={org} slot="gallery" ticket={gallery.ticket} items={gallery.items} />
      </Card>
    </>
  );
}
