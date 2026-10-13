import { engineStaffAlerts } from '@yayatoh/alerts';
import { ASSISTANCE_CHANNEL } from '@yayatoh/assistance';
import { deviceIdOf, type StaffAlertSource, staffOverviewQuery, supervisorViewQuery } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, executeQuery } from '@yayatoh/kernel';
import { CHECKINS_CHANNEL, DEVICES_CHANNEL, realtimeChannelName } from '@yayatoh/platform';

/**
 * Staff mode of the door apps (M3.4a; the Scan PWA and, from M7.2e, the Staff app): where the
 * alerts list comes from, and the overview as the device reads it.
 *
 * `staffAlertSource` is the check-in module's per-device alerts (device offline, low battery,
 * backlog, capacity near) on the Command Center alert engine's state, so what the organizer
 * acknowledged or snoozed is quiet on the devices too (same in the worker).
 */
export const staffAlertSource: StaffAlertSource = engineStaffAlerts();

export const staffOverview = staffOverviewQuery(staffAlertSource);
export const supervisorView = supervisorViewQuery(staffAlertSource);

/**
 * The staff screen of the device: counts, the device board and alerts of its event, plus the
 * realtime channels to follow (the device does not know its org id; the token does) and its own
 * id. The PWA's `GET /api/scan/staff` and `GET /v1/staff/events/{eventId}/overview` both answer
 * with exactly this.
 */
export async function staffOverviewFor(ctx: Ctx, eventId: string, ports: CommandPorts<TenantTx>) {
  const view = await executeQuery(staffOverview, { eventId }, ctx, ports);
  const orgId = ctx.orgId ?? '';
  const channels = {
    checkins: realtimeChannelName(CHECKINS_CHANNEL, orgId, eventId),
    devices: realtimeChannelName(DEVICES_CHANNEL, orgId, eventId),
    // M3.3b: the help queue on the staff screen.
    assistance: realtimeChannelName(ASSISTANCE_CHANNEL, orgId, eventId),
  };
  return { ...view, channels, deviceId: deviceIdOf(ctx) };
}
