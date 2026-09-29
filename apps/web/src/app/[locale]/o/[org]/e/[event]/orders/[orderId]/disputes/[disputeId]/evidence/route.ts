import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { disputeEvidencePacketQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { z } from 'zod';
import { loadEvent } from '@/server/console.ts';
import { evidencePacketDocument, renderEvidencePdf } from '@/server/evidence.ts';
import { ports } from '@/server/ports.ts';

/**
 * The dispute evidence packet as a PDF (owner, admin, finance). It is written in English: it goes
 * to the card network. Without a PDF renderer the same document comes back as printable HTML.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ org: string; event: string; orderId: string; disputeId: string }> },
) {
  const { org, event, orderId, disputeId } = await params;
  if (!z.uuid().safeParse(disputeId).success) return new Response('Not found', { status: 404 });
  const { data } = await loadEvent(org, event, 'ticketsOrders');
  if (!roleCan(data.role, 'finance:read')) return new Response('Not found', { status: 404 });
  let evidence: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(disputeEvidencePacketQuery, { disputeId }, data.ctx, ports);
  try {
    evidence = await load();
  } catch (err) {
    // Staff acting as a member never take files out (M1.2e).
    if (isDomainError(err) && err.code === 'impersonation_blocked')
      return new Response('Not available while acting as a member', {
        status: 403,
        headers: { 'cache-control': 'no-store' },
      });
    if (isDomainError(err) && err.code === 'not_found') return new Response('Not found', { status: 404 });
    throw err;
  }
  if (evidence.order.id !== orderId) return new Response('Not found', { status: 404 });
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  try {
    const out = await renderEvidencePdf(await evidencePacketDocument(evidence));
    if (out.kind === 'html')
      return new Response(out.html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
    if (out.kind === 'too_large')
      return new Response('The packet is over the card networks’ limits (4.5 MB / 19 pages).', {
        status: 422,
        headers,
      });
    return new Response(new Uint8Array(out.bytes), {
      headers: {
        ...headers,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="dispute-evidence-${disputeId.slice(-8)}.pdf"`,
      },
    });
  } catch (err) {
    console.error('evidence pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...headers, 'retry-after': '5' },
    });
  }
}
