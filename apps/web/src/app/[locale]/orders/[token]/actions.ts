'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  assignHoldersCommand,
  manageTokenOrg,
  orderHolderTarget,
  registerOrderPushCommand,
  removeOrderPushCommand,
  requestRefundCommand,
} from '@yayatoh/orders';
import { submitReviewCommand } from '@yayatoh/reviews';
import { revalidatePath, updateTag } from 'next/cache';
import { headers } from 'next/headers';
import type {
  PushActionResult,
  PushSubscriptionInput,
  RemoveDeviceState,
} from '@/components/web-push-control.tsx';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import { deviceLabel } from '@/lib/device-label.ts';
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

const codeOf = (err: unknown) =>
  isDomainError(err)
    ? (err.details as { reason?: string } | undefined)?.reason === 'too_many_devices'
      ? 'too_many_devices'
      : err.code
    : 'internal';

/** The manage link is the buyer's only credential: it resolves the org and, inside, the buyer. */
async function ctxFor(token: string) {
  const orgId = await manageTokenOrg(token);
  return orgId ? createCtx({ orgId }) : null;
}

export type HoldersState = FormState & { readonly ticketId?: string };

/**
 * "Name all holders at once": one name and email per ticket; the system sends each person their own
 * ticket (the transfer/claim flow). Rows left empty are skipped. The manage link is the credential.
 */
export async function assignHoldersAction(
  token: string,
  _prev: HoldersState,
  form: FormData,
): Promise<HoldersState> {
  const limit = await limitAction('holderLink', { identity: `assign:${token}`, scope: 'assign' });
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const orgId = (await orderHolderTarget(token))?.orgId;
  if (!orgId) return { ok: false, code: 'not_found' };
  const holders = form
    .getAll('ticket')
    .map(String)
    .map((ticketId) => ({
      ticketId,
      name: String(form.get(`name:${ticketId}`) ?? '').trim(),
      email: String(form.get(`email:${ticketId}`) ?? '').trim(),
      phone: String(form.get(`phone:${ticketId}`) ?? '')
        .replace(/[\s().-]/g, '')
        .trim(),
    }))
    .filter((h) => h.name || h.email);
  const badPhone = holders.find((h) => h.phone && !/^\+[1-9]\d{6,14}$/.test(h.phone));
  if (badPhone)
    return { ok: false, code: 'validation_failed', reason: 'bad_phone', ticketId: badPhone.ticketId };
  if (holders.length === 0) return { ok: false, code: 'validation_failed', reason: 'nothing_entered' };
  const incomplete = holders.find((h) => !h.name || !h.email);
  if (incomplete)
    return {
      ok: false,
      code: 'validation_failed',
      reason: 'incomplete',
      ticketId: incomplete.ticketId,
    };
  try {
    await executeCommand(
      assignHoldersCommand,
      {
        manageToken: token,
        holders: holders.map(({ phone, ...h }) => ({ ...h, ...(phone ? { phone } : {}) })),
      },
      createCtx({ orgId }),
      ports,
    );
  } catch (err) {
    const state = failure(err);
    const ticketId = (err as { details?: { ticketId?: unknown } }).details?.ticketId;
    return typeof ticketId === 'string' ? { ...state, ticketId } : state;
  }
  revalidatePath(`/orders/${token}`);
  return success();
}

/** Opt this browser in to push for the order's buyer (M1.10e). */
export async function subscribeOrderPushAction(
  token: string,
  sub: PushSubscriptionInput,
): Promise<PushActionResult> {
  const ctx = await ctxFor(token);
  if (!ctx) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(
      registerOrderPushCommand,
      {
        token,
        subscription: {
          endpoint: sub.endpoint,
          keys: sub.keys,
          timeZone: sub.timeZone,
          label: deviceLabel((await headers()).get('user-agent')),
        },
      },
      ctx,
      ports,
    );
  } catch (err) {
    return { ok: false, code: codeOf(err) };
  }
  revalidatePath(`/orders/${token}`);
  return { ok: true, code: null };
}

/** "Turn off on this device": forget this browser's subscription. */
export async function unsubscribeOrderPushAction(token: string, endpoint: string): Promise<PushActionResult> {
  const ctx = await ctxFor(token);
  if (!ctx) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(removeOrderPushCommand, { token, endpoint }, ctx, ports);
  } catch (err) {
    return { ok: false, code: codeOf(err) };
  }
  revalidatePath(`/orders/${token}`);
  return { ok: true, code: null };
}

/** Remove a device from the buyer's list (a no-JS form). */
export async function removeOrderDeviceAction(
  token: string,
  _prev: RemoveDeviceState,
  form: FormData,
): Promise<RemoveDeviceState> {
  const ctx = await ctxFor(token);
  if (!ctx) return { removed: false, code: 'not_found' };
  try {
    await executeCommand(
      removeOrderPushCommand,
      { token, deviceId: String(form.get('deviceId') ?? '') },
      ctx,
      ports,
    );
  } catch (err) {
    return { removed: false, code: codeOf(err) };
  }
  revalidatePath(`/orders/${token}`);
  return { removed: true, code: null };
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
