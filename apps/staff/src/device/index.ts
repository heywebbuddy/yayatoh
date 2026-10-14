/** The door device (M7.4a): enrolment, the `yyd_` token in secure storage, heartbeat, wipe. */
export { batteryPercent } from './battery';
export { type Enrolment, enrolmentFromLink, looksLikeEnrolmentLink, redactEnrolment } from './link';
export { type DeviceApi, DeviceProvider, useDevice } from './provider';
export {
  createDeviceSession,
  type DeviceCheckpoint,
  type DeviceEvent,
  type DeviceSession,
  type DeviceState,
  type DeviceStatus,
  type EnrolOutcome,
  EVENT_WINDOW,
  type HeartbeatOutcome,
  insideEventWindow,
  type WipeReason,
} from './session';
