'use server';

import { isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import { REFUND_REASONS, type RefundOutcome, type RefundReason, refundOrder } from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

export type RefundState = { readonly ok: boolean; readonly code: string | null; readonly reason?: string };

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
    );
  } catch (err) {
    return {
      ok: false,
      code: isDomainError(err) ? err.code : 'internal',
      reason: isDomainError(err) ? String(err.details?.reason ?? '') : undefined,
    };
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return done.status === 'failed' ? { ok: false, code: 'refund_failed' } : { ok: true, code: null };
}
