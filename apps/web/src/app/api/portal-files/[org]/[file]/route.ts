import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { portalFileQuery } from '@yayatoh/media';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { orgActor } from '@/server/org-actor.ts';
import { ports } from '@/server/ports.ts';
import { getSession, sessionOpensOrg } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * An organizer's download of a portal file (M5.3a): a speaker's task answer or proposed photo.
 * Needs a signed-in member of the org with `events:read` (the query authorizes); never cached,
 * never rendered (the API CSP sandboxes it, `nosniff`), images inline and documents as downloads.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; file: string }> }) {
  const { org, file } = await params;
  if (!UUID.test(file)) return notFound();
  const session = await getSession();
  if (!session) return new Response('Sign in required', { status: 401 });
  const resolved = await resolveOrgSlug(org);
  if (!resolved) return notFound();
  // A member, or (M6.7a) an agency acting through the client's live grant.
  const actor = await orgActor(resolved.orgId, session);
  if (!actor) return notFound();
  const ctx = actor.ctx;
  try {
    const f = await executeQuery(portalFileQuery, { fileId: file }, ctx, ports);
    const inline = f.contentType.startsWith('image/');
    const name = encodeURIComponent(f.fileName);
    return new Response(Buffer.from(f.bytes), {
      status: 200,
      headers: {
        'content-type': f.contentType,
        'content-length': String(f.bytes.byteLength),
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (isDomainError(err)) return notFound();
    throw err;
  }
}
