'use server';

import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { orderDetailQuery } from '@yayatoh/orders';
import {
  disputesQuery,
  EVIDENCE_OPTIONAL_SECTIONS,
  markOrgEvidenceSubmittedCommand,
  saveEvidenceDraftCommand,
} from '@yayatoh/payments';
import { disputeEvidencePacketQuery } from '@yayatoh/reports';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { evidencePacketDocument, renderEvidencePdf } from '@/server/evidence.ts';
import { failure, success } from '@/server/form.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

type Section = (typeof EVIDENCE_OPTIONAL_SECTIONS)[number];

/**
 * Review a dispute's evidence (M1.6e): save the statement and the sections to leave out, or —
 * after the reviewer confirms they read the packet — submit it through the payment port (on the
 * connected account for organizer_mor), then record the submission. Audited by the commands.
 */
export async function evidenceAction(
  org: string,
  event: string,
  orderId: string,
  disputeId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event, 'ticketsOrders');
  const included = new Set(form.getAll('include').map(String));
  const input = {
    disputeId,
    summary: String(form.get('summary') ?? '').trim(),
    excluded: EVIDENCE_OPTIONAL_SECTIONS.filter((s) => !included.has(s)) as Section[],
  };
  const path = `/o/${org}/e/${event}/orders/${orderId}`;
  try {
    await executeCommand(saveEvidenceDraftCommand, input, data.ctx, ports);
    if (form.get('intent') !== 'submit') {
      revalidatePath(path, 'layout');
      return success();
    }
    if (form.get('reviewed') !== 'yes')
      return { ok: false, code: 'validation_failed', reason: 'not_reviewed' };
    if (input.summary.length < 10) return { ok: false, code: 'validation_failed', fields: ['summary'] };
    const [dispute] = (await executeQuery(disputesQuery, { orderId }, data.ctx, ports)).filter(
      (d) => d.id === disputeId,
    );
    if (!dispute) return { ok: false, code: 'not_found' };
    const order = await executeQuery(orderDetailQuery, { orderId }, data.ctx, ports);
    const evidence = await executeQuery(disputeEvidencePacketQuery, { disputeId }, data.ctx, ports);
    const packet = await renderEvidencePdf(await evidencePacketDocument(evidence));
    if (packet.kind === 'too_large')
      return { ok: false, code: 'validation_failed', reason: 'packet_too_large' };
    const sent = await getPaymentProvider().submitDisputeEvidence({
      providerDisputeId: dispute.providerDisputeId,
      summary: input.summary,
      packet:
        packet.kind === 'pdf'
          ? { bytes: packet.bytes, filename: `dispute-evidence-${disputeId.slice(-8)}.pdf` }
          : null,
      connectedAccountId: dispute.fundsFlow === 'organizer_mor' ? order.connectedAccountId : null,
      idempotencyKey: `evidence:${disputeId}`,
    });
    if (sent.status !== 'submitted')
      return { ok: false, code: 'validation_failed', reason: 'provider_refused' };
    await executeCommand(markOrgEvidenceSubmittedCommand, input, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err)) return failure(err);
    throw err;
  }
  revalidatePath(path, 'layout');
  return success();
}
