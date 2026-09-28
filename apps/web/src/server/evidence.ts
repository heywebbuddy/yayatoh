import 'server-only';
import { formatMoney, money } from '@yayatoh/kernel';
import { disputeEvidenceHtml } from '@yayatoh/pdf';
import {
  type DisputeEvidenceDto,
  EVIDENCE_LABELS,
  type EvidenceDocument,
  evidenceDocument,
  fitEvidenceDocument,
  packetWithinLimits,
} from '@yayatoh/reports';
import { getTranslations } from 'next-intl/server';
import { getPdfRenderer } from '@/server/pdf.ts';

/**
 * The evidence packet as it is sent (M1.6e): in English (it goes to the card network), with the
 * reviewer's statement and exclusions, fitted to the networks' 19 pages. The console preview, the
 * PDF download and the submission all use this one document.
 */
export async function evidencePacketDocument(evidence: DisputeEvidenceDto): Promise<EvidenceDocument> {
  const t = await getTranslations({ locale: 'en', namespace: 'evidence' });
  const doc = evidenceDocument(evidence, {
    locale: 'en',
    label: (k, v) => (EVIDENCE_LABELS.includes(k) ? t(k, v) : k),
    money: (m, c) => formatMoney(money(m, c), 'en'),
  });
  return fitEvidenceDocument(doc, (n) => t('trimmed', { n }));
}

export type EvidencePdf =
  | { readonly kind: 'pdf'; readonly bytes: Uint8Array }
  | { readonly kind: 'html'; readonly html: string }
  | { readonly kind: 'too_large'; readonly bytes: number; readonly pages: number };

/** Render the packet: a PDF within 4.5 MB / 19 pages, or printable HTML when no renderer is set. */
export async function renderEvidencePdf(doc: EvidenceDocument): Promise<EvidencePdf> {
  const html = disputeEvidenceHtml(doc);
  const renderer = getPdfRenderer();
  if (!renderer) return { kind: 'html', html };
  const bytes = new Uint8Array(await renderer.render({ html }));
  const check = packetWithinLimits(bytes);
  return check.ok ? { kind: 'pdf', bytes } : { kind: 'too_large', bytes: check.bytes, pages: check.pages };
}
