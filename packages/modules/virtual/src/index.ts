// M6.9a: virtual v1 — delivery and access modes, signed playback, heartbeat watch time.
export {
  createStreamCommand,
  revealStreamKeyCommand,
  SetTicketAccessInput,
  setStreamEnabledCommand,
  setTicketAccessCommand,
  streamingUsageQuery,
  virtualSetupQuery,
} from './commands.ts';
// M6.1c data-subject requests: watch time per session is exported; streams are not about anyone.
export { virtualDataSubjects } from './data-subject.ts';
export {
  ACCESS_MODES,
  type AccessMode,
  DELIVERY_MODES,
  type DeliveryMode,
  defaultAccess,
  effectiveAccess,
  isDeliveryMode,
  mayWatch,
} from './domain/access.ts';
export {
  type BeatVerdict,
  beatVerdict,
  HEARTBEAT_INTERVAL_MS,
  MAX_SEQ,
  MINUTE_MS,
  minuteOf,
  PLAYBACK_TTL_MS,
  RENEW_BEFORE_MS,
  splitMinutes,
} from './domain/watch.ts';
export * from './dto.ts';
export { privateColumns } from './private-columns.ts';
export { FAKE_INGEST_URL, FAKE_KID, fakePlaybackCheck, fakeVideoProvider } from './provider/fake.ts';
export { MAX_TOKEN_LENGTH } from './provider/jwt.ts';
export { MUX_INGEST_URL, muxVideoProvider } from './provider/mux.ts';
export {
  type LiveStream,
  type PlaybackClaims,
  type VideoProvider,
  VideoUnavailableError,
} from './provider/port.ts';
export {
  configureVirtual,
  currentVideoProvider,
  videoProvider,
  videoProviderFromEnv,
} from './provider/registry.ts';
export {
  heartbeatCommand,
  playbackOrg,
  startPlaybackCommand,
  TICKET_PURPOSE,
  VIEWS_PER_HOUR,
  viewerQuery,
  virtualAttended,
  virtualTicketToken,
  watchableTicketsQuery,
} from './viewer.ts';
// M6.9b: Zoom webinars (registrant rows, attendance reports) and online attendance for CE credits.
export {
  linkZoomWebinarCommand,
  normalizeWebinarId,
  onlineAttendanceTx,
  reconcileZoomRegistrantsTx,
  recordZoomAttendanceTx,
  splitHolderName,
  syncZoomRegistrantsCommand,
  ZOOM_REPORT_DAYS,
  type ZoomRegistrantRecord,
  zoomRegistrantChangesTx,
  zoomRegistrantsSubscriber,
  zoomRegistrantTx,
  zoomReportWebinarsTx,
  zoomSetupQuery,
} from './zoom.ts';
