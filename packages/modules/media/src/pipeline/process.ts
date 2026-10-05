import { createHash } from 'node:crypto';
import sharp, { type Metadata, type Sharp } from 'sharp';
import {
  CONTENT_TYPES,
  MAX_INPUT_PIXELS,
  MAX_SVG_BYTES,
  MAX_UPLOAD_BYTES,
  type PlannedVariant,
  planVariants,
  type VariantFormat,
} from './plan.ts';
import { type SourceType, sniff } from './sniff.ts';
import { SvgRejected, sanitizeSvg } from './svg.ts';

// One upload at a time per worker thread is plenty; no cross-request pixel cache.
sharp.cache(false);

export type RejectReason =
  | 'too_large'
  | 'unsupported_type'
  | 'undecodable'
  | 'too_many_pixels'
  | 'svg_malformed'
  | 'svg_not_svg'
  | 'svg_too_complex';

/** An upload the pipeline refuses; `reason` maps to a message in the uploader. */
export class MediaRejected extends Error {
  readonly reason: RejectReason;
  constructor(reason: RejectReason) {
    super(reason);
    this.reason = reason;
  }
}

export interface ProcessedVariant {
  readonly format: VariantFormat;
  readonly width: number;
  readonly height: number;
  readonly fallback: boolean;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** SHA-256 of `bytes`, hex. */
  readonly hash: string;
}

export interface ProcessedImage {
  readonly sourceType: SourceType;
  readonly width: number;
  readonly height: number;
  readonly variants: readonly ProcessedVariant[];
  /** What the SVG sanitizer removed (empty for rasters). */
  readonly removed: readonly string[];
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function encode(img: Sharp, v: PlannedVariant): Sharp {
  const resized = img
    .clone()
    .resize({ width: v.width, height: v.height, fit: 'fill', withoutEnlargement: false });
  switch (v.format) {
    case 'avif':
      return resized.avif({ quality: 50, effort: 3 });
    case 'webp':
      return resized.webp({ quality: 80, effort: 4 });
    case 'jpeg':
      return resized.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true });
    case 'png':
      return resized.png({ compressionLevel: 9 });
    case 'svg':
      throw new Error('svg variants are not encoded');
  }
}

/**
 * Sniff, sanitize (SVG), decode and re-encode an upload. Rasters are decoded once (first frame
 * of an animation only), auto-oriented from EXIF and re-encoded; the encoders write no metadata,
 * so EXIF (GPS, camera serials), XMP, IPTC and ICC profiles never reach a variant.
 */
export async function processImage(
  bytes: Uint8Array,
  /** M4.5b: gallery uploads go straight to storage, so they may be larger than a request body. */
  opts: { readonly maxBytes?: number } = {},
): Promise<ProcessedImage> {
  if (bytes.byteLength > (opts.maxBytes ?? MAX_UPLOAD_BYTES)) throw new MediaRejected('too_large');
  const type = sniff(bytes);
  if (!type) throw new MediaRejected('unsupported_type');

  let input: Uint8Array = bytes;
  let removed: readonly string[] = [];
  let svgText: string | null = null;
  if (type === 'svg') {
    if (bytes.byteLength > MAX_SVG_BYTES) throw new MediaRejected('too_large');
    try {
      const clean = sanitizeSvg(bytes);
      svgText = clean.svg;
      removed = clean.removed;
    } catch (err) {
      if (err instanceof SvgRejected) throw new MediaRejected(err.reason);
      throw err;
    }
    // Rasterize only the sanitized document.
    input = new TextEncoder().encode(svgText);
  }

  const img = sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: 'error',
    animated: false,
    autoOrient: true,
  });
  let meta: Metadata;
  try {
    meta = await img.metadata();
  } catch (err) {
    if (/pixel limit/i.test(String(err))) throw new MediaRejected('too_many_pixels');
    throw new MediaRejected('undecodable');
  }
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new MediaRejected('undecodable');
  if (width * height > MAX_INPUT_PIXELS) throw new MediaRejected('too_many_pixels');

  const plan = planVariants({ type, width, height, hasAlpha: meta.hasAlpha === true });
  const variants: ProcessedVariant[] = [];
  for (const v of plan) {
    let out: Uint8Array;
    let w = v.width;
    let h = v.height;
    if (v.format === 'svg') {
      out = new TextEncoder().encode(svgText ?? '');
    } else {
      try {
        const { data, info } = await encode(img, v).toBuffer({ resolveWithObject: true });
        out = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        w = info.width;
        h = info.height;
      } catch (err) {
        if (/pixel limit/i.test(String(err))) throw new MediaRejected('too_many_pixels');
        throw new MediaRejected('undecodable');
      }
    }
    variants.push({
      format: v.format,
      width: w,
      height: h,
      fallback: v.fallback,
      contentType: CONTENT_TYPES[v.format],
      bytes: out,
      hash: sha256(out),
    });
  }
  return { sourceType: type, width, height, variants, removed };
}
