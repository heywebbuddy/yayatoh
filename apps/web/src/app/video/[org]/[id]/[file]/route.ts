import { readVideoObject } from '@yayatoh/media';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * An uploaded video or its poster (`/video/{org}/{id}/{file}`): on the app's own origin so pages
 * keep `media-src 'self'`. The file name carries the content hash, so a URL never changes content
 * (immutable caching), and the unguessable ids make the link as private as an unlisted page:
 * organizers upload only what they mean to show. Byte ranges are answered (206) so players seek and
 * stream instead of downloading the whole file first.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; id: string; file: string }> },
): Promise<Response> {
  const { org, id, file } = await params;
  if (!UUID.test(org) || !UUID.test(id)) return notFound();
  const obj = await readVideoObject(org, id, file);
  if (!obj) return notFound();
  const total = obj.bytes.byteLength;
  const headers: Record<string, string> = {
    'content-type': obj.contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; sandbox",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : total - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : total - 1;
    start = Math.max(0, start);
    end = Math.min(end, total - 1);
    if (start > end || start >= total)
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${total}` } });
    const part = obj.bytes.subarray(start, end + 1);
    return new Response(part as Uint8Array<ArrayBuffer>, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': String(part.byteLength) },
    });
  }
  return new Response(obj.bytes as Uint8Array<ArrayBuffer>, {
    headers: { ...headers, 'content-length': String(total) },
  });
}

export const HEAD = GET;
