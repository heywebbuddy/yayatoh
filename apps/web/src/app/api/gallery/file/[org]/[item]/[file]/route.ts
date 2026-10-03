import { readGalleryFile } from '@yayatoh/gallery';

const INERT_CSP = "default-src 'none'; sandbox";

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': INERT_CSP,
    },
  });

/**
 * A gallery photo file (M4.5b): `/api/gallery/file/{org}/{item}/{width}-{hash}.{ext}?e=&s=`. The
 * URL is signed by the gallery query that listed the photo for a viewer it authorized (a host,
 * or a guest past the site's password) and works until the end of the next UTC day, and only
 * while the photo still exists. Private caching only, same-origin, inert, never indexed.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; item: string; file: string }> },
): Promise<Response> {
  const { org, item, file } = await params;
  const q = new URL(req.url).searchParams;
  const found = await readGalleryFile(org, item, file, q.get('e'), q.get('s'));
  if (!found) return notFound();
  const etag = `"${found.sha256}"`;
  const headers: Record<string, string> = {
    'content-type': found.contentType,
    'cache-control': 'private, max-age=86400',
    etag,
    'content-disposition': `inline; filename="${file}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': INERT_CSP,
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  headers['content-length'] = String(found.bytes.byteLength);
  return new Response(found.bytes as Uint8Array<ArrayBuffer>, { headers });
}

export const HEAD = GET;
