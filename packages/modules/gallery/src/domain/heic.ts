/**
 * HEIC/HEIF detection (M4.5b): phones save photos as HEIC (an ISO-BMFF `ftyp` box with a HEVC
 * brand). The media pipeline's sniffer does not accept it; the gallery recognises it here and
 * decodes it through the `HeicDecoder` port before the same re-encoding as every other photo.
 */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export function isHeic(b: Uint8Array): boolean {
  if (b.length < 16 || ascii(b, 4, 8) !== 'ftyp') return false;
  const size = ((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0);
  if (size < 16 || size > Math.min(b.length, 4096) || size % 4 !== 0) return false;
  const brands = [ascii(b, 8, 12)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, i + 4));
  // AVIF files also list `mif1`; the media sniffer takes those first.
  if (brands.includes('avif') || brands.includes('avis')) return false;
  return brands.some((x) => HEIC_BRANDS.has(x));
}

/** The MIME types the gallery's file picker offers (the server sniffs; this is only a hint). */
export const GALLERY_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  '.heic',
  '.heif',
] as const;
