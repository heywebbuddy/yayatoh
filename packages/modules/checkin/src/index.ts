export { EARLY_ENTRY_MS, eventDay, LATE_ENTRY_MS, ruleResult } from '@yayatoh/checkin-engine';
export {
  checkpointNamesTx,
  deviceLabelsTx,
  queueStaffPushTx,
} from './assistance-support.ts';
// M5.1d: admit a ticket whose invoice still has a balance (audited staff override).
export { admitBalanceDueCommand } from './balance-override.ts';
export {
  CheckpointDto,
  createCheckpointCommand,
  INVALID_BURST,
  listCheckpointsQuery,
  setCheckpointArchivedCommand,
  TWO_ENTRANCES_WINDOW_MS,
} from './checkpoints.ts';
// M5.9a: the conference Command Center pack's counts (alert rules and widgets read these).
export { kiosksOfflineTx, sessionsInRoomTx } from './conference-facts.ts';
// M6.1a: contact merges move this module's references (ADR 0023).
export { checkinContactOwner } from './contact-merge.ts';
// M6.2a: check-ins per day (first live admission) for the analytics warehouse.
export { dailyCheckinFactsTx } from './daily-facts.ts';
export { checkinDataSubjects } from './data-subject.ts';
export {
  DEVICE_ONLINE_WINDOW_MS,
  DeviceDto,
  deviceContext,
  deviceEventIdTx,
  deviceHealthTx,
  deviceIdOf,
  deviceManifestQuery,
  devicesOnlineTx,
  enrollDeviceCommand,
  heartbeatCommand,
  listDevicesQuery,
  ManifestPageDto,
  SyncResultDto,
  setDeviceStateCommand,
  syncScansCommand,
} from './devices.ts';
export { admissionsDsarTx, purgeScansBeforeTx } from './dsar.ts';
export {
  ALERT_WINDOW_MS,
  alertsFor,
  BLOCK_REPEAT_WINDOW_MS,
  CHAT_REPORT_SEVERITY,
  chatReportSignal,
  checkoutRiskSignal,
  type MappedSignal,
  type SubjectType,
  shouldAlert,
  signalSubject,
} from './fraud-rules.ts';
export { chatReportSignals, checkoutRiskSignals, fraudSignalAlerts } from './fraud-sources.ts';
// M4.4b: guest check-in by name or party, the guest kiosk and A–Z board snapshot, the day-of view.
export {
  ARRIVAL_RESULTS,
  type ArrivalResult,
  DAY_OF_ARRIVALS_SHOWN,
  DAY_OF_MATCHES,
  DayOfDto,
  dayOfQuery,
  GuestArrivalsInput,
  GuestArrivalsResult,
  GuestSnapshotDto,
  guestArrivedTx,
  guestSnapshotQuery,
  MAX_ARRIVALS_PER_SYNC,
  markGuestsArrivedCommand,
  recordGuestArrivalsCommand,
  undoGuestArrivalCommand,
} from './guest-checkin.ts';
export { requireKioskDeviceTx } from './kiosk-device.ts';
export {
  admittedTodayByCheckpointTx,
  capacityFactsTx,
  DEVICE_IN_USE_MS,
  deviceAppVersionsTx,
  FEED_KINDS,
  type FeedFilter,
  type FeedItem,
  type FeedKind,
  feedKindOf,
  lastScanByDeviceTx,
  liveFeedTx,
  liveLabelsTx,
  markQuietDevicesTx,
  onDutyStaffTx,
  PRESENCE_PING_MS,
  PRESENCE_TTL_MS,
  type PresenceRow,
  presenceActive,
  reportPresenceCommand,
  type ScanIssue,
  scanIssuesTx,
  scanWindowTx,
  staffPresenceTx,
} from './live.ts';
// M5.8b: networking chat reports → chat_abuse signals.
export { networkChatSignal, networkChatSignals } from './network-chat-signals.ts';
export { privateColumns } from './private-columns.ts';
export {
  admissionsForTicketsTx,
  admittedTicketIdsSql,
  admittedTicketIdsTx,
  CheckinStatusDto,
  checkinStatusQuery,
  ScanOutcomeDto,
  scanLogForTicketsTx,
  scanTicketCommand,
  undoAdmissionCommand,
} from './scan.ts';
export {
  ARRIVAL_SOURCES,
  type ArrivalSource,
  CHECKPOINT_KINDS,
  type CheckpointKind,
  DEVICE_EVENT_KINDS,
  type DeviceEventKind,
  FRAUD_NOTE_MAX,
  FRAUD_SEVERITIES,
  FRAUD_SEVERITY,
  FRAUD_SIGNAL_KINDS,
  FRAUD_SOURCES,
  FRAUD_STATUSES,
  type FraudSeverity,
  type FraudSignalKind,
  type FraudSource,
  type FraudStatus,
  KIOSK_KINDS,
  type KioskKind,
  SCAN_RESULTS,
  type ScanResult,
  STAFF_ALERT_KINDS,
  STAFF_PUSH_KINDS,
  type StaffAlertKind,
  type StaffPushKind,
  VIRTUAL_CHECKPOINT_KIND,
} from './schema.ts';
// M5.6a: session check-in (gates, scan in/out, overrides, attendance, self check-in flyers).
export {
  admitSessionOverrideCommand,
  SELF_CHECKIN_EARLY_MS,
  SELF_CHECKIN_RESULTS,
  SelfCheckinPageDto,
  SessionAttendanceDto,
  SessionChoiceDto,
  selfCheckInCommand,
  selfCheckinDoor,
  selfCheckinPageQuery,
  sessionAttendanceQuery,
  sessionDoorChoicesQuery,
  setSelfCheckinCommand,
} from './session-checkin.ts';
export {
  occupiedTx,
  type SessionAccessSource,
  type SessionDoor,
  sessionAccessSource,
  sessionDoorTx,
  setSessionAccessSource,
  type TicketSessionAccess,
} from './session-doors.ts';
export {
  DetectionSettingsDto,
  detectionSettingsQuery,
  FRAUD_NOTE_MIN_DISMISS,
  FraudSignalDto,
  listFraudSignalsQuery,
  orderSignalsQuery,
  resolveFraudSignalCommand,
  setDetectionSettingsCommand,
} from './signals.ts';
export {
  DoorStaffDto,
  doorStaffQuery,
  myScanScopeQuery,
  removeDoorStaffCommand,
  type ScanScope,
  setDoorStaffCommand,
} from './staff.ts';
export {
  BACKLOG_SCANS,
  CAPACITY_NEAR_PCT,
  capacityPercent,
  deriveStaffAlerts,
  deviceOnline,
  LOW_BATTERY_PCT,
  renderStaffPush,
  STAFF_OFFLINE_AFTER_MS,
  type StaffAlert,
  SUPERVISOR_ALERT_KINDS,
} from './staff-alerts.ts';
export {
  BoardDeviceDto,
  canSuperviseTx,
  claimStaffPushCommand,
  derivedStaffAlerts,
  exitKioskCommand,
  hashKioskPin,
  KIOSK_PIN_ITERATIONS,
  kioskKindOf,
  requestDeviceSyncCommand,
  revokeDeviceCommand,
  type StaffAlertSource,
  StaffOverviewDto,
  StaffPushInput,
  type StaffPushSender,
  SupervisorDeviceDto,
  SupervisorViewDto,
  sendStaffAlertPushes,
  staffAlertsSubscriber,
  staffBoardTx,
  staffOverviewQuery,
  staffPushStatusQuery,
  stageStaffAlertPushesTx,
  startKioskCommand,
  stopKioskCommand,
  subscribeStaffPushCommand,
  supervisorViewQuery,
  switchDeviceCheckpointCommand,
  unsubscribeStaffPushCommand,
  verifyKioskPin,
} from './staff-mode.ts';
export { type CheckinScope, type CheckinSeriesFact, checkinFactsTx, checkinSeriesTx } from './stats.ts';
// M6.1a: the person timeline's facts from this module (crm projection).
export { checkinTimeline } from './timeline.ts';
// M6.9a: the virtual checkpoint (watching a session's stream checks the ticket in).
export {
  VirtualCheckpointDto,
  virtualAttendanceSubscriber,
  virtualCheckpointName,
  virtualCheckpointsQuery,
  virtualCheckpointTx,
} from './virtual-attendance.ts';
