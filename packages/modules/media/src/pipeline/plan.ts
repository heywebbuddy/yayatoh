import type { SourceType } from './sniff.ts';

/**
 * Variant planning (M1.4e): which files an upload becomes. Pure, so it is unit-tested apart
 * from the encoder.
 *
 * - Rasters (and rasterized SVGs) become AVIF and WebP at the standard widths below the source
 *   width, plus the source width itself (capped at the largest standard width). Nothing is
 *   ever enlarged.
 * - One **fallback** for places that can't take AVIF/WebP (email clients, some OG scrapers):
 *   PNG when the image has transparency or is an SVG, JPEG otherwise, at most 1280 px wide.
 * - SVGs also keep their sanitized vector (`svg`).
 */
export const STANDARD_WIDTHS = [320, 640, 1280, 1920] as const;
export const FALLBACK_MAX_WIDTH = 1280;

/**
 * Upload limits. Bytes are checked before anything is decoded; pixels before anything is resized.
 * 4 MB fits Vercel's 4.5 MB request-body cap for functions; direct-to-R2 uploads (presigned, the
 * upload ticket's shape) can raise it once the owner's bucket exists.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_SVG_BYTES = 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;

export const VARIANT_FORMATS = ['avif', 'webp', 'jpeg', 'png', 'svg'] as const;
export type VariantFormat = (typeof VARIANT_FORMATS)[number];

export const CONTENT_TYPES: Readonly<Record<VariantFormat, string>> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
};
export const EXTENSIONS: Readonly<Record<VariantFormat, string>> = {
  avif: 'avif',
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
  svg: 'svg',
};

export interface PlannedVariant {
  readonly format: VariantFormat;
  readonly width: number;
  readonly height: number;
  /** The fallback raster (PNG/JPEG) used for email and OG images. */
  readonly fallback: boolean;
}

/** Height for a width, keeping the aspect ratio (never below 1 px). */
export const scaledHeight = (width: number, srcW: number, srcH: number) =>
  Math.max(1, Math.round((width * srcH) / srcW));

/** The responsive widths for a source width. */
export function plannedWidths(srcWidth: number): number[] {
  const max = Math.min(srcWidth, STANDARD_WIDTHS[STANDARD_WIDTHS.length - 1] as number);
  const out: number[] = STANDARD_WIDTHS.filter((w) => w < max);
  out.push(max);
  return out;
}

export function planVariants(src: {
  type: SourceType;
  width: number;
  height: number;
  hasAlpha: boolean;
}): PlannedVariant[] {
  if (!(src.width >= 1 && src.height >= 1)) throw new RangeError('source dimensions must be positive');
  const out: PlannedVariant[] = [];
  for (const w of plannedWidths(src.width)) {
    const h = scaledHeight(w, src.width, src.height);
    out.push({ format: 'avif', width: w, height: h, fallback: false });
    out.push({ format: 'webp', width: w, height: h, fallback: false });
  }
  const fw = Math.min(src.width, FALLBACK_MAX_WIDTH);
  out.push({
    format: src.hasAlpha || src.type === 'svg' ? 'png' : 'jpeg',
    width: fw,
    height: scaledHeight(fw, src.width, src.height),
    fallback: true,
  });
  if (src.type === 'svg') out.push({ format: 'svg', width: src.width, height: src.height, fallback: false });
  return out;
}

/** A variant's file name: width, content hash and extension (`640-3f2a…c9.webp`). */
export function variantFileName(v: { format: VariantFormat; width: number; hash: string }): string {
  return `${v.width}-${v.hash.slice(0, 32)}.${EXTENSIONS[v.format]}`;
}

export const FILE_NAME = /^(\d{1,5})-([0-9a-f]{32})\.(avif|webp|jpg|png|svg)$/;
