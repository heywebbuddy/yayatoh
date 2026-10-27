import { documentTarget, readDocument } from '@yayatoh/media';
import { orgActor } from '@/server/org-actor.ts';
import { getSession } from '@/server/session.ts';
import { currentAccess } from '@/server/visitor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

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
 * A sponsor's or exhibitor's PDF brochure: `/api/program-docs/{org}/{doc}/{name}.pdf`. Anyone may
 * read it while the owner's event is public; for a private event only a visitor holding its access
 * grant; otherwise only signed-in members of the org. Everything else is a plain 404. The file
 * name in the URL is cosmetic (the document id picks the file).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; doc: string; file: string }> },
): Promise<Response> {
  const { org, doc } = await params;
  if (!UUID.test(org) || !UUID.test(doc)) return notFound();
  const target = await documentTarget(org, doc);
  if (!target) return notFound();
  const isPublic = target.visibility === 'public';
  if (!isPublic) {
    let allowed = false;
    if (target.visibility === 'private_event' && target.eventId) {
      allowed = Boolean((await currentAccess(org, target.eventId))?.unlocksEvent);
    }
    if (!allowed) {
      const session = await getSession();
      allowed = session ? (await orgActor(org, session)) !== null : false;
    }
    if (!allowed) return notFound();
  }
  const etag = `"${target.sha256}"`;
  const headers: Record<string, string> = {
    'content-type': 'application/pdf',
    'cache-control': `${isPublic ? 'public' : 'private'}, max-age=3600`,
    etag,
    'content-disposition': `inline; filename="${target.fileName.replace(/[^\w. -]/g, '_')}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': INERT_CSP,
    'referrer-policy': 'no-referrer',
  };
  if (!isPublic) headers.vary = 'Cookie';
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const bytes = await readDocument(org, target.storageKey);
  if (!bytes) return notFound();
  headers['content-length'] = String(bytes.byteLength);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
}

export const HEAD = GET;
