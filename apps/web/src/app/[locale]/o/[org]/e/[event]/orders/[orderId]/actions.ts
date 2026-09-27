'use server';

import { executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import {
  completeRefundCommand,
  REFUND_REASONS,
  type RefundReason,
  startRefundCommand,
} from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { loadEvent } from '@/server/console.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

export type RefundState = { readonly ok: boolean; readonly code: string | null; readonly reason?: string };

/**
 * Refund tickets or an amount: the command records it with the policy's amounts, the provider
 * refunds on the right account (outside the transaction), and the answer is recorded.
 */
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
  let started: z.output<typeof startRefundCommand.output>;
  try {
    started = await executeCommand(
      startRefundCommand,
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
    );
  } catch (err) {
    return {
      ok: false,
      code: isDomainError(err) ? err.code : 'internal',
      reason: isDomainError(err) ? String(err.details?.reason ?? '') : undefined,
    };
  }
  const provider = getPaymentProvider();
  const res = await provider.refund({
    providerPaymentId: started.provider.providerPaymentId,
    amount: { amount: started.amountMinor, currency: started.currency },
    connectedAccountId: started.provider.connectedAccountId,
    refundApplicationFee: {
      amount: started.provider.fundsFlow === 'organizer_mor' ? started.feeRefundedMinor : 0,
      currency: started.currency,
    },
    idempotencyKey: `refund:${started.refundId}`,
  });
  const done = await executeCommand(
    completeRefundCommand,
    { refundId: started.refundId, outcome: res.status, providerRefundId: res.refundId },
    data.ctx,
    ports,
  );
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return done.status === 'failed' ? { ok: false, code: 'refund_failed' } : { ok: true, code: null };
}
