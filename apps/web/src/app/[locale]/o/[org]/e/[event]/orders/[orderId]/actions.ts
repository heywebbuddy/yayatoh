'use server';

import { isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import {
  REFUND_REASONS,
  type RefundOutcome,
  type RefundReason,
  refundOrder,
  startPolicyOverrideRefundCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

export type RefundState = {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** A refund policy refusal (M1.6e): when discretionary refunds closed (ISO). */
  readonly deadline?: string;
  readonly field?: string;
};

/** Refund tickets or an amount through the shared refund flow (the same one /v1 uses). */
export async function refundAction(
  org: string,
  event: string,
  orderId: string,
  _prev: RefundState,
  form: FormData,
): Promise<RefundState> {
  const { data, event: ev } = await loadEvent(org, event);
  const reason = String(form.get('reason') ?? '') as RefundReason;
  if (!REFUND_REASONS.includes(reason)) return { ok: false, code: 'validation_failed' };
  const mode = form.get('mode') === 'amount' ? 'amount' : 'tickets';
  // M1.6e: refunding outside the event's refund policy is its own, audited command (owners, admins).
  const override = form.get('override') === 'yes';
  let done: RefundOutcome;
  try {
    done = await refundOrder(
      mode === 'tickets'
        ? {
            orderId,
            reason,
            ticketIds: form.getAll('ticket').map(String),
            note: String(form.get('note') ?? ''),
          }
        : {
            orderId,
            reason,
            amountMinor: moneyFromDecimal(String(form.get('amount') ?? '0') || '0', ev.currency).amount,
            note: String(form.get('note') ?? ''),
          },
      data.ctx,
      ports,
      getPaymentProvider(),
      override ? startPolicyOverrideRefundCommand : startRefundCommand,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = (err.details ?? {}) as { reason?: unknown; deadline?: unknown; issues?: { path: string }[] };
    return {
      ok: false,
      code: err.code,
      reason: typeof d.reason === 'string' ? d.reason : '',
      ...(typeof d.deadline === 'string' ? { deadline: d.deadline } : {}),
      ...(d.issues?.some((i) => i.path.startsWith('note')) ? { field: 'note' } : {}),
    };
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return done.status === 'failed' ? { ok: false, code: 'refund_failed' } : { ok: true, code: null };
}
