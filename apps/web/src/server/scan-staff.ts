import 'server-only';
import {
  deviceFromAuthorization,
  staffAlertSource,
  staffOverview,
  staffPushEndpointAllowed,
  subscribeStaffPush,
  supervisorView,
} from '@yayatoh/api-v1/staff';
import type { StaffPushSender } from '@yayatoh/checkin';
import type { Ctx } from '@yayatoh/kernel';
import { devMailboxTransports, fakePushAllowed, withWebPush } from '@yayatoh/notifications';
import { problem, problemResponse } from '@yayatoh/platform/http';
import { webPushConfig } from './web-push.ts';

/**
 * Staff mode of the Scan PWA (M3.4a), composed for the web app. What the PWA's routes and the
 * Staff app's `/v1/staff/*` routes both read and write lives in `@yayatoh/api-v1/staff` (M7.2e:
 * one implementation); this file is the web side: the request's device and the dev push sender.
 */
export { staffAlertSource, staffOverview, staffPushEndpointAllowed, subscribeStaffPush, supervisorView };

/** The web push adapter for staff alerts (dev drain; the worker composes its own). */
export function staffPushSender(appOrigin: string): StaffPushSender | null {
  const push = withWebPush(devMailboxTransports(), {
    vapid: webPushConfig(),
    appOrigin,
    fakeOrigin: fakePushAllowed() ? appOrigin : null,
  }).push;
  return push ? { send: (m) => push.send(m) } : null;
}

/**
 * The device behind a Scan PWA request: its bearer token decides the org (never a header or a
 * parameter). A missing, unknown or revoked token is a problem+json 401.
 */
export async function scanDevice(req: Request): Promise<{ ctx: Ctx } | Response> {
  const ctx = await deviceFromAuthorization(req.headers.get('authorization'));
  if (!ctx) return problemResponse(problem('unauthenticated', 'Device token required'));
  return { ctx };
}
