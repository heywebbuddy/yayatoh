import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { disputeEvidenceHtml } from '@yayatoh/pdf';
import {
  disputeEvidenceQuery,
  EVIDENCE_LABELS,
  evidenceDocument,
  fitEvidenceDocument,
} from '@yayatoh/reports';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { getPdfRenderer } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

/** The evidence packet for staff review (English: it goes to the card network). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; disputeId: string }> }) {
  const { id, disputeId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(disputeId).success)
    return new Response('Not found', { status: 404 });
  const staff = await requireStaff('payouts');
  let evidence: Awaited<ReturnType<typeof load>>;
  const load = () => executeQuery(disputeEvidenceQuery, { disputeId }, staff.ctx(id), ports);
  try {
    evidence = await load();
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return new Response('Not found', { status: 404 });
    throw err;
  }
  const t = await getTranslations('evidence');
  // The same packet the organizer reviews (their statement and exclusions), fitted to 19 pages.
  const document = disputeEvidenceHtml(
    fitEvidenceDocument(
      evidenceDocument(evidence, {
        locale: 'en',
        label: (k, v) => (EVIDENCE_LABELS.includes(k) ? t(k, v) : k),
        money: (m, c) => formatMoney(money(m, c), 'en'),
      }),
      (n) => t('trimmed', { n }),
    ),
  );
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  const renderer = getPdfRenderer();
  if (!renderer)
    return new Response(document, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  const pdf = await renderer.render({ html: document });
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...headers,
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="dispute-evidence-${disputeId.slice(-8)}.pdf"`,
    },
  });
}
