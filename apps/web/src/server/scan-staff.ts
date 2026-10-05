import 'server-only';
import {
  derivedStaffAlerts,
  deviceContext,
  type StaffAlertSource,
  type StaffPushSender,
  staffOverviewQuery,
  subscribeStaffPushCommand,
  supervisorViewQuery,
} from '@yayatoh/checkin';
import type { Ctx } from '@yayatoh/kernel';
import {
  devMailboxTransports,
  fakePushAllowed,
  isAllowedPushEndpoint,
  withWebPush,
} from '@yayatoh/notifications';
import { problem, problemResponse } from '@yayatoh/platform/http';
import { webPushConfig } from './web-push.ts';

/**
 * Staff mode of the Scan PWA (M3.4a), composed for the web app.
 *
 * `staffAlertSource` is where the alerts list comes from: the check-in module's derived alerts
 * (device offline, low battery, backlog, capacity near) until the Command Center alert engine
 * (M3.2b) lands; it then replaces this one line (and the same line in the worker).
 */
export const staffAlertSource: StaffAlertSource = derivedStaffAlerts;

export const staffOverview = staffOverviewQuery(staffAlertSource);
export const supervisorView = supervisorViewQuery(staffAlertSource);

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

/** The web push adapter for staff alerts (dev drain; the worker composes its own). */
export function staffPushSender(appOrigin: string): StaffPushSender | null {
  const push = withWebPush(devMailboxTransports(), {
    vapid: webPushConfig(),
    appOrigin,
    fakeOrigin: fakePushAllowed() ? appOrigin : null,
  }).push;
  return push ? { send: (m) => push.send(m) } : null;
}

const BEARER = /^Bearer (yyd_[A-Za-z0-9_-]{43})$/;

/**
 * The device behind a Scan PWA request: its bearer token decides the org (never a header or a
 * parameter). A missing, unknown or revoked token is a problem+json 401.
 */
export async function scanDevice(req: Request): Promise<{ ctx: Ctx } | Response> {
  const m = BEARER.exec(req.headers.get('authorization') ?? '');
  const dc = m?.[1] ? await deviceContext(m[1]) : null;
  if (!dc) return problemResponse(problem('unauthenticated', 'Device token required'));
  return { ctx: dc.ctx };
}
