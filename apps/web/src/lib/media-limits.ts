/**
 * Upload limits the browser checks before sending (M1.4e). The server is the authority (it
 * sniffs the bytes and re-checks everything); these mirror `@yayatoh/media` without pulling its
 * encoder into the client bundle — `tests/media-limits.test.ts` keeps them equal.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const;
export const UPLOAD_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'] as const;
export const GALLERY_MAX = 20;

/** Whether a picked file looks like an allowed image (type, or extension when the type is empty). */
export function looksLikeImage(file: { name: string; type: string }): boolean {
  if (file.type) return (UPLOAD_ACCEPT as readonly string[]).includes(file.type);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return (UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}

/** "4 MB" in the reader's locale. */
export const formatMegabytes = (bytes: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(
    bytes / (1024 * 1024),
  );
