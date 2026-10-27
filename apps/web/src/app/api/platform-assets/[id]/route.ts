import { platformAsset } from '@yayatoh/cms';

const INERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * An image or video staff uploaded in the admin console for the blog, testimonials or the home
 * hero. Public (the content it belongs to is public); the id is unguessable and the file never
 * changes (a new upload gets a new id), so it caches for a long time. Served inert.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const asset = await platformAsset(id);
  if (!asset) return notFound();
  const etag = `"${asset.sha256}"`;
  const headers: Record<string, string> = {
    'content-type': asset.contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': INERT_CSP,
    'cross-origin-resource-policy': 'cross-origin',
    'accept-ranges': 'bytes',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range) {
    const size = asset.bytes.byteLength;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers });
    const part = asset.bytes.slice(start, end + 1);
    return new Response(part as Uint8Array<ArrayBuffer>, {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(part.byteLength),
      },
    });
  }
  headers['content-length'] = String(asset.bytes.byteLength);
  return new Response(asset.bytes as Uint8Array<ArrayBuffer>, { headers });
}

export const HEAD = GET;
