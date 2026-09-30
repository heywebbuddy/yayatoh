import { createHash } from 'node:crypto';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { disputeEvidenceHtml } from '@yayatoh/pdf';
import {
  disputeEvidencePacketQuery,
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
  const load = () => executeQuery(disputeEvidencePacketQuery, { disputeId }, staff.ctx(id), ports);
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
  const headers = {
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
    // A static document (M1.3f): no scripts at all; only its own <style> block, by hash.
    'content-security-policy': documentCsp(document),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
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

/** No scripts, no network; the document's inline <style> blocks are allowed by their SHA-256. */
function documentCsp(doc: string): string {
  const styles = [...doc.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
  return [
    "default-src 'none'",
    `style-src ${styles.length ? styles.join(' ') : "'none'"}`,
    "style-src-attr 'none'",
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
