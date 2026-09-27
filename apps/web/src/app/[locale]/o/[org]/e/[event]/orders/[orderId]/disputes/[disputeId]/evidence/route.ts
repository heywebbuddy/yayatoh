import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { disputeEvidenceHtml } from '@yayatoh/pdf';
import { disputeEvidenceQuery, EVIDENCE_LABELS, evidenceDocument } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { loadEvent } from '@/server/console.ts';
import { getPdfRenderer } from '@/server/pdf.ts';
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
  const { data } = await loadEvent(org, event);
  if (!roleCan(data.role, 'finance:read')) return new Response('Not found', { status: 404 });
  let evidence: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(disputeEvidenceQuery, { disputeId }, data.ctx, ports);
  try {
    evidence = await load();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return new Response('Not found', { status: 404 });
    throw err;
  }
  if (evidence.order.id !== orderId) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale: 'en', namespace: 'evidence' });
  const doc = evidenceDocument(evidence, {
    locale: 'en',
    label: (k, v) => (EVIDENCE_LABELS.includes(k) ? t(k, v) : k),
    money: (m, c) => formatMoney(money(m, c), 'en'),
  });
  const document = disputeEvidenceHtml(doc);
  const renderer = getPdfRenderer();
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  if (!renderer)
    return new Response(document, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  try {
    const pdf = await renderer.render({ html: document });
    return new Response(new Uint8Array(pdf), {
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
