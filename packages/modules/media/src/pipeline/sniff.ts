/**
 * Magic-byte sniffing (M1.4e). The file's name and the request's Content-Type are never trusted:
 * only these byte signatures decide what an upload is. Anything else is `unsupported`.
 */
export const SOURCE_TYPES = ['jpeg', 'png', 'gif', 'webp', 'avif', 'svg'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** The MIME types the file picker offers (a hint for the browser only; the server sniffs). */
export const ACCEPT_MIME = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const;

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** ISO-BMFF `ftyp` box whose major or compatible brands name AVIF (`avif` still, `avis` sequence). */
function isAvif(b: Uint8Array): boolean {
  if (b.length < 16 || ascii(b, 4, 8) !== 'ftyp') return false;
  const size = ((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0);
  if (size < 16 || size > Math.min(b.length, 4096) || size % 4 !== 0) return false;
  const brands = [ascii(b, 8, 12)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, i + 4));
  return brands.includes('avif') || brands.includes('avis');
}

/**
 * An SVG document: valid UTF-8 text without NUL bytes whose first element is `<svg`, after an
 * optional BOM, XML declaration, DOCTYPE, comments and whitespace. The DOCTYPE is only skipped
 * here; the sanitizer discards it without ever defining its entities.
 */
function isSvg(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, 4096));
  } catch {
    // A multi-byte sequence cut at 4096 is fine; anything else is not UTF-8.
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, 4093));
    } catch {
      return false;
    }
  }
  let s = text.replace(/^\uFEFF/, '');
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s.startsWith('<?xml')) {
      const end = s.indexOf('?>');
      if (end < 0) return false;
      s = s.slice(end + 2);
    } else if (s.startsWith('<!--')) {
      const end = s.indexOf('-->');
      if (end < 0) return false;
      s = s.slice(end + 3);
    } else if (/^<!DOCTYPE\s+svg[\s>[]/i.test(s)) {
      // Editors write `<!DOCTYPE svg PUBLIC …>`; any internal subset ends with `]>`.
      const bracket = s.indexOf('[');
      const close = s.indexOf('>');
      const end = bracket >= 0 && bracket < close ? s.indexOf(']>', bracket) + 1 : close;
      if (end <= 0) return false;
      s = s.slice(end + 1);
    } else break;
  }
  return /^<svg[\s>/]/.test(s) || /^<svg:svg[\s>/]/.test(s);
}

/** What the bytes are, or null when they are none of the allowed types. */
export function sniff(bytes: Uint8Array): SourceType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (isAvif(bytes)) return 'avif';
  if (isSvg(bytes)) return 'svg';
  return null;
}
