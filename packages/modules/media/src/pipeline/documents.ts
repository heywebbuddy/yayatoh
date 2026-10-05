import type { PortalFileType } from '../schema-files.ts';

/**
 * M5.3a portal files: what a task answer or a proposed photo is, from its bytes only (the name and
 * Content-Type are never trusted). PDF by its header; PowerPoint and Word (OOXML) as a ZIP whose
 * entries include `[Content_Types].xml` and the `ppt/` or `word/` part (entry names are stored
 * uncompressed in the ZIP headers); images by their signatures.
 */
export const PORTAL_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** A proposed photo is later processed like any speaker photo (`MAX_UPLOAD_BYTES`). */
export const PORTAL_PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export const PORTAL_FILE_EXT: Readonly<Record<PortalFileType, string>> = {
  pdf: 'pdf',
  pptx: 'pptx',
  docx: 'docx',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};
export const PORTAL_FILE_CONTENT_TYPES: Readonly<Record<PortalFileType, string>> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
export const PORTAL_IMAGE_TYPES: readonly PortalFileType[] = ['jpeg', 'png', 'webp'];

const startsWith = (b: Uint8Array, sig: readonly number[]) =>
  b.length >= sig.length && sig.every((v, i) => b[i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Whether the ZIP's entry names include `needle` (a byte search; names are not compressed). */
function zipHasEntry(b: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= b.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

export function sniffPortalFile(bytes: Uint8Array): PortalFileType | null {
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && zipHasEntry(bytes, '[Content_Types].xml')) {
    if (zipHasEntry(bytes, 'ppt/presentation.xml')) return 'pptx';
    if (zipHasEntry(bytes, 'word/document.xml')) return 'docx';
    return null;
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * A display and download name: no path, no control or quoting characters, at most 120
 * characters, and the extension of the sniffed type (whatever the upload claimed).
 */
export function cleanFileName(name: string, type: PortalFileType): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(/\p{Cc}/gu, '')
    .replace(/["<>|:*?;]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || 'file'}.${PORTAL_FILE_EXT[type]}`;
}
