import { cx } from '@yayatoh/ui';
import type { MediaItem } from '@/server/media.ts';

/**
 * A console thumbnail of a speaker photo or an exhibitor/sponsor logo (M1.4h): 48 px, the right
 * WebP from the variants (or the SVG), width/height attributes so nothing shifts, and the
 * image's own alt text. Nothing when the row has no image.
 */
export function ProgramThumb({ item, round = false }: { item: MediaItem | undefined; round?: boolean }) {
  if (!item) return null;
  return (
    <img
      src={item.preview}
      srcSet={item.srcSet || undefined}
      sizes={item.srcSet ? '48px' : undefined}
      alt={item.alt ?? ''}
      width={item.width}
      height={item.height}
      loading="lazy"
      decoding="async"
      className={cx(
        'size-12 shrink-0 border border-zinc-200 bg-white',
        round ? 'rounded-full object-cover' : 'rounded-card object-contain p-1',
      )}
    />
  );
}
