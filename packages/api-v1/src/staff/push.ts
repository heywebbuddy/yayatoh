import {
  staffPushStatusQuery,
  subscribeStaffNativePushCommand,
  subscribeStaffPushCommand,
  unsubscribeStaffPushCommand,
} from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { fakePushAllowed, isAllowedPushEndpoint } from '@yayatoh/notifications';

/** Known push services only; in dev/CI also the fake push service on this origin. */
export function staffPushEndpointAllowed(endpoint: string): boolean {
  if (isAllowedPushEndpoint(endpoint)) return true;
  if (!fakePushAllowed()) return false;
  try {
    return isAllowedPushEndpoint(endpoint, { fakeOrigin: new URL(endpoint).origin });
  } catch {
    return false;
  }
}

export const subscribeStaffPush = subscribeStaffPushCommand(staffPushEndpointAllowed);

/** Is staff push on for this device (opt-in per device, M3.4a)? */
export function staffPushStatus(ctx: Ctx, ports: CommandPorts<TenantTx>) {
  return executeQuery(staffPushStatusQuery, {}, ctx, ports);
}

const unpad = (v: unknown) => (typeof v === 'string' ? v.replace(/=+$/, '') : v);

/** Turn on web push for this device: the browser's subscription plus the text in the device's language. */
export async function subscribeWebPush(
  ctx: Ctx,
  body: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    locale?: unknown;
    copy?: unknown;
  },
  ports: CommandPorts<TenantTx>,
) {
  await executeCommand(
    subscribeStaffPush,
    {
      endpoint: body.endpoint as string,
      keys: { p256dh: unpad(body.keys?.p256dh) as string, auth: unpad(body.keys?.auth) as string },
      locale: body.locale as string,
      copy: body.copy as never,
    },
    ctx,
    ports,
  );
  return { ok: true };
}

/**
 * Turn on staff alerts on APNs or FCM for this device (the Staff app, M7.2e): the device's one
 * subscription row, replaced by a new registration and deleted when the device is revoked or wiped.
 */
export function registerNativePush(ctx: Ctx, body: unknown, ports: CommandPorts<TenantTx>) {
  return executeCommand(subscribeStaffNativePushCommand, body as never, ctx, ports);
}

/** Turn staff push off for this device (web or native). */
export function unsubscribeStaffPush(ctx: Ctx, ports: CommandPorts<TenantTx>) {
  return executeCommand(unsubscribeStaffPushCommand, {}, ctx, ports);
}
