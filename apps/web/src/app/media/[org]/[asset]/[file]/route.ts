import { createCtx } from '@yayatoh/kernel';
import { CONTENT_TYPES, FILE_NAME, readVariant, serveTarget, type VariantFormat } from '@yayatoh/media';
import { memberRole } from '@yayatoh/tenancy';
import { getSession } from '@/server/session.ts';
import { currentAccess } from '@/server/visitor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An image variant (M1.4e): `/media/{org}/{asset}/{width}-{hash}.{ext}` on the app's own origin,
 * so pages keep `img-src 'self'`. The name carries the content hash, so a URL never changes
 * content: long-lived immutable caching.
 *
 * Who gets it: anyone when the owner is public (a published public/unlisted event, a listed venue,
 * an active org's logo); a visitor holding the event's access grant for a private event; otherwise
 * only signed-in members of that org. Everything else — another org's private image included —
 * is the same 404 as a file that doesn't exist.
 *
 * Every response is inert: SVGs are sanitized at upload and are also sent with a CSP that blocks
 * scripts, plugins and loads (`sandbox`), and `nosniff` stops any type guessing.
 */
const INERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': INERT_CSP,
    },
  });
}

async function allowedPrivately(orgId: string, eventId: string | null, visibility: string): Promise<boolean> {
  // The event's access grant also opens its program's images (M1.4h: `eventId` is the event of a
  // speaker, exhibitor or sponsor).
  if (visibility === 'private_event' && eventId) {
    const grant = await currentAccess(orgId, eventId);
    if (grant?.unlocksEvent) return true;
  }
  const session = await getSession();
  if (!session) return false;
  // Staff acting as a member (M1.2e) see only the org they started from.
  if (session.impersonation && session.impersonation.orgId !== orgId) return false;
  return (await memberRole(createCtx({ orgId, actor: { type: 'user', userId: session.userId } }))) !== null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; asset: string; file: string }> },
): Promise<Response> {
  const { org, asset, file } = await params;
  if (!UUID.test(org) || !UUID.test(asset) || !FILE_NAME.test(file)) return notFound();
  const target = await serveTarget(org, asset, file);
  if (!target) return notFound();
  const isPublic = target.visibility === 'public';
  if (!isPublic && !(await allowedPrivately(org, target.eventId, target.visibility))) return notFound();

  const etag = `"${target.sha256}"`;
  const headers: Record<string, string> = {
    'content-type': CONTENT_TYPES[target.format as VariantFormat] ?? 'application/octet-stream',
    'cache-control': `${isPublic ? 'public' : 'private'}, max-age=31536000, immutable`,
    etag,
    'content-disposition': `inline; filename="${file}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': INERT_CSP,
    // Public images may be shown by other origins (email clients, social previews); private ones
    // stay same-origin.
    'cross-origin-resource-policy': isPublic ? 'cross-origin' : 'same-origin',
    'referrer-policy': 'no-referrer',
  };
  if (!isPublic) headers.vary = 'Cookie';
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const bytes = await readVariant(org, asset, file);
  if (!bytes) return notFound();
  headers['content-length'] = String(bytes.byteLength);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
}

export const HEAD = GET;
