import type { PhotoView } from './types.ts';

/**
 * A gallery photo (M4.5b): AVIF and WebP at every stored width, the JPEG/PNG fallback for the
 * rest. Width and height are attributes (no inline style under the strict CSP), so the layout
 * doesn't jump while it loads.
 */
export function GalleryPhoto({
  photo,
  alt,
  sizes,
  className,
  eager = false,
}: {
  photo: PhotoView;
  alt: string;
  sizes: string;
  className?: string;
  eager?: boolean;
}) {
  const set = (format: 'avif' | 'webp') =>
    photo.files
      .filter((f) => f.format === format)
      .map((f) => `${f.url} ${f.width}w`)
      .join(', ');
  const fallback = photo.files.find((f) => f.fallback) ?? photo.files.at(-1);
  if (!fallback) return null;
  return (
    <picture>
      {set('avif') ? <source type="image/avif" srcSet={set('avif')} sizes={sizes} /> : null}
      {set('webp') ? <source type="image/webp" srcSet={set('webp')} sizes={sizes} /> : null}
      <img
        src={fallback.url}
        alt={alt}
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className={className}
      />
    </picture>
  );
}
