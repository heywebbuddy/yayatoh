import type { GalleryLabels } from '@/components/gallery-lightbox.tsx';

/** The lightbox's words, from `publicEvent.lightbox` (`{n}` and `{total}` stay for it to fill). */
export const galleryLabels = (t: (key: string, values?: Record<string, string>) => string): GalleryLabels => {
  const place = { n: '{n}', total: '{total}' };
  return {
    open: t('open', place),
    dialog: t('dialog'),
    close: t('close'),
    previous: t('previous'),
    next: t('next'),
    counter: t('counter', place),
    thumbnails: t('thumbnails'),
  };
};
