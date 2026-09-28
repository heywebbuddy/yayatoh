import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { emailPreviewQuery, PREVIEW_HEADERS } from '@yayatoh/notifications';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { ports } from '@/server/ports.ts';
import { getSession } from '@/server/session.ts';

/**
 * A stored email preview (M1.10d), framed by the announcement composer and the template editor.
 * Served with its own policy (inline styles only, no scripts, sandboxed) so the email renders as
 * sent while the console page keeps its strict CSP. The org comes from the path and the session
 * must belong to a member; only the preview's creator can open it, for ten minutes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const notFound = () =>
    new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  if (!/^[a-z0-9-]{1,63}$/.test(org) || !/^[0-9a-f-]{36}$/.test(id)) return notFound();
  const session = await getSession();
  if (!session) return notFound();
  const resolved = await resolveOrgSlug(org);
  if (!resolved) return notFound();
  // Staff acting as a member (M1.2e) see only the org they started from.
  const imp = session.impersonation;
  if (imp && imp.orgId !== resolved.orgId) return notFound();
  const ctx = createCtx({
    orgId: resolved.orgId,
    actor: { type: 'user', userId: session.userId },
    impersonatedBy: imp ? { staffUserId: imp.staffUserId, impersonationId: imp.id } : null,
  });
  try {
    const { html } = await executeQuery(emailPreviewQuery, { id }, ctx, ports);
    return new Response(html, { headers: PREVIEW_HEADERS });
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'validation_failed'].includes(err.code))
      return notFound();
    throw err;
  }
}
