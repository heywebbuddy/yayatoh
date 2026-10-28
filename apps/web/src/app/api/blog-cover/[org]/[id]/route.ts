import { entryCover } from '@yayatoh/cms';

const INERT_CSP = "default-src 'none'; sandbox";

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * The cover image of a published organization blog post. Public (the post is), and the file never
 * changes under its id (a new upload gets a new id), so it caches for a long time. Served inert.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; id: string }> },
): Promise<Response> {
  const { org, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(org)) return notFound();
  const cover = await entryCover(org, id);
  if (!cover) return notFound();
  const etag = `"${cover.sha256}"`;
  const headers = {
    'content-type': cover.contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': INERT_CSP,
    'cross-origin-resource-policy': 'cross-origin',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(cover.bytes as Uint8Array<ArrayBuffer>, {
    headers: { ...headers, 'content-length': String(cover.bytes.byteLength) },
  });
}

export const HEAD = GET;
