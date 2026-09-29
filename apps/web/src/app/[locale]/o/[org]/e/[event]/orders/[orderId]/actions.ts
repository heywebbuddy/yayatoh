'use server';

import { executeCommand, executeQuery, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import {
  addOrderNoteCommand,
  declineRefundRequestCommand,
  orderDetailQuery,
  REFUND_REASONS,
  type RefundOutcome,
  type RefundReason,
  refundOrder,
  refundRequestsQuery,
  reissueManageLinkCommand,
  startPolicyOverrideRefundCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
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

export type ReissueState = { readonly ok: boolean; readonly code: string | null };

/**
 * M1.5f buyer support: revoke the order's manage link and email the buyer a new one (the old one
 * stops working at once). `orders:support`; refused for viewers and finance even from a stale page.
 */
export async function reissueLinkAction(
  org: string,
  event: string,
  orderId: string,
  _prev: ReissueState,
  form: FormData,
): Promise<ReissueState> {
  if (form.get('confirm') !== 'yes') return { ok: false, code: 'validation_failed' };
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const order = await executeQuery(orderDetailQuery, { orderId }, data.ctx, ports);
    if (order.eventId !== ev.id) return { ok: false, code: 'not_found' };
    await executeCommand(reissueManageLinkCommand, { orderId }, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err)) return { ok: false, code: err.code };
    throw err;
  }
  return { ok: true, code: null };
}

/**
 * Approve a buyer's refund request (M3.10b): the same refund flow (command, step-up for large
 * refunds, provider keyed by the refund), linked to the request, under the policy as it stood when
 * the buyer asked. The tickets they asked for, or an amount (tickets stay valid).
 */
export async function approveRequestAction(
  org: string,
  event: string,
  orderId: string,
  requestId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const [request] = (await executeQuery(refundRequestsQuery, { orderId }, data.ctx, ports)).filter(
    (r) => r.id === requestId,
  );
  if (!request) return { ok: false, code: 'not_found' };
  const reason: RefundReason = ev.status === 'cancelled' ? 'event_cancelled' : 'requested_by_customer';
  let ticketIds = request.ticketIds;
  if (ticketIds.length === 0) {
    const order = await executeQuery(orderDetailQuery, { orderId }, data.ctx, ports);
    ticketIds = order.tickets.filter((t) => t.status === 'active').map((t) => t.id);
  }
  let amountMinor = 0;
  if (form.get('mode') === 'amount') {
    try {
      amountMinor = moneyFromDecimal(
        String(form.get('amount') ?? '0').replace(',', '.') || '0',
        ev.currency,
      ).amount;
    } catch {
      return { ok: false, code: 'validation_failed', fields: ['amountMinor'] };
    }
  }
  try {
    const done = await refundOrder(
      form.get('mode') === 'amount'
        ? { orderId, reason, amountMinor, refundRequestId: requestId }
        : { orderId, reason, ticketIds, refundRequestId: requestId },
      data.ctx,
      ports,
      getPaymentProvider(),
    );
    if (done.status === 'failed') return { ok: false, code: 'refund_failed' };
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}`, 'layout');
  return success();
}

/** Decline a buyer's refund request with a reason they are emailed (M3.10b). */
export async function declineRequestAction(
  org: string,
  event: string,
  requestId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event);
  try {
    await executeCommand(
      declineRefundRequestCommand,
      { requestId, reason: String(form.get('reason') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}`, 'layout');
  return success();
}

/** Add an internal note to the order (M3.10b timeline). */
export async function addNoteAction(
  org: string,
  event: string,
  orderId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event);
  try {
    await executeCommand(
      addOrderNoteCommand,
      { orderId, body: String(form.get('body') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/orders/${orderId}`);
  return success();
}
