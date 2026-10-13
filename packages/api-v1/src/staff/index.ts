/**
 * What the Scan PWA's `/api/scan/*` route handlers and the Staff app's `/v1/staff/*` routes share
 * (M7.2e): one implementation of each door-staff read and write, so the two cannot drift. The web
 * app imports this as `@yayatoh/api-v1/staff`; the PWA's behaviour is unchanged.
 */
export {
  openAssistanceQueue,
  raiseStaffRequest,
  STAFF_ASSISTANCE_ACTIONS,
  type StaffAssistanceAction,
  workStaffRequest,
} from './assistance.ts';
export { deviceFromAuthorization } from './device.ts';
export { checkinCardEntry, guestSnapshotFor, recordGuestArrivals } from './guests.ts';
export { alertsEngineWidget, type OpsView, opsViewFor } from './ops.ts';
export { staffAlertSource, staffOverview, staffOverviewFor, supervisorView } from './overview.ts';
export {
  registerNativePush,
  staffPushEndpointAllowed,
  staffPushStatus,
  subscribeStaffPush,
  subscribeWebPush,
  unsubscribeStaffPush,
} from './push.ts';
