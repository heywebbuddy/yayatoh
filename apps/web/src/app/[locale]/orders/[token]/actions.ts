'use server';

import { createCtx, executeCommand } from '@yayatoh/kernel';
import { orderHolderTarget, requestRefundCommand } from '@yayatoh/orders';
import { submitReviewCommand } from '@yayatoh/reviews';
import { revalidatePath, updateTag } from 'next/cache';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * A buyer reviews the event from their order page (M1.4g). The manage-link token is the proof of
 * holding; the org comes from it (never from the request); the command re-checks everything.
 */
export async function submitReviewAction(
  token: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const limit = await limitAction('reviewSubmit', { identity: `order:${token}` });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const target = await orderHolderTarget(token);
  if (!target) return { ok: false, code: 'not_found' };
  const rating = Number(form.get('rating') ?? '');
  try {
    await executeCommand(
      submitReviewCommand,
      { manageToken: token, rating, body: String(form.get('body') ?? '') },
      createCtx({ orgId: target.orgId }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  for (const tag of orgChangeTags(target.orgId)) updateTag(tag);
  revalidatePath(`/orders/${token}`);
  return success();
}

/**
 * A buyer asks for a refund from their order page (M3.10b). The manage-link token is the
 * credential and names the org (never the request); the command checks the policy the order was
 * bought under and allows one open request per order. Rate limited per token and per client.
 */
export async function requestRefundAction(
  token: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const limit = await limitAction('refundRequest', { identity: `order:${token}` });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  // The link proves holding: only a buyer who still holds a ticket of theirs can ask.
  const orgId = (await orderHolderTarget(token))?.orgId;
  if (!orgId) return { ok: false, code: 'not_found' };
  const ticketIds = form.getAll('ticket').map(String);
  if (ticketIds.length === 0) return { ok: false, code: 'validation_failed', fields: ['ticketIds'] };
  try {
    await executeCommand(
      requestRefundCommand,
      { manageToken: token, ticketIds, message: String(form.get('message') ?? '') },
      createCtx({ orgId }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/orders/${token}`);
  return success();
}
