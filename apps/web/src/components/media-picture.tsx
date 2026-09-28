import { cx } from '@yayatoh/ui';

/** The fields a picture needs (public DTOs and console DTOs both have them). */
export interface PictureSource {
  readonly alt: string | null;
  readonly decorative: boolean;
  readonly width: number;
  readonly height: number;
  readonly variants: readonly {
    format: string;
    width: number;
    height: number;
    url: string;
    fallback: boolean;
  }[];
}

const srcSet = (p: PictureSource, format: string) =>
  p.variants
    .filter((v) => v.format === format)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');

/** The fallback (PNG/JPEG) variant: email, OG images, and browsers without AVIF/WebP. */
export const fallbackOf = (p: PictureSource) => p.variants.find((v) => v.fallback) ?? p.variants[0];

/**
 * A responsive image from media variants (M1.4e): AVIF, then WebP, then the PNG/JPEG fallback,
 * all from `/media/…` on this origin (CSP `img-src 'self'`). SVG uploads render their sanitized
 * vector. Decorative images get `alt=""`. Sizes come from the width/height attributes (no inline
 * styles under the strict CSP).
 */
export function MediaPicture({
  image,
  sizes,
  className,
  eager = false,
}: {
  image: PictureSource;
  sizes: string;
  className?: string;
  eager?: boolean;
}) {
  const alt = image.decorative ? '' : (image.alt ?? '');
  const vector = image.variants.find((v) => v.format === 'svg');
  const fallback = fallbackOf(image);
  const common = {
    width: image.width,
    height: image.height,
    loading: eager ? ('eager' as const) : ('lazy' as const),
    decoding: 'async' as const,
    className: cx('block', className),
  };
  if (vector) return <img src={vector.url} alt={alt} {...common} />;
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(image, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(image, 'webp')} sizes={sizes} />
      <img src={fallback?.url} alt={alt} {...common} />
    </picture>
  );
}
