'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { manageTokenOrg, registerOrderPushCommand, removeOrderPushCommand } from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type {
  PushActionResult,
  PushSubscriptionInput,
  RemoveDeviceState,
} from '@/components/web-push-control.tsx';
import { deviceLabel } from '@/lib/device-label.ts';
import { ports } from '@/server/ports.ts';

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
