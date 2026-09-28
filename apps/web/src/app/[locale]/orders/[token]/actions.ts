'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  manageTokenOrg,
  orderHolderTarget,
  registerOrderPushCommand,
  removeOrderPushCommand,
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
