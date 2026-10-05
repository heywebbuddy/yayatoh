// M6.9a: virtual v1 — delivery and access modes, signed playback, heartbeat watch time.
export {
  createStreamCommand,
  revealStreamKeyCommand,
  SetTicketAccessInput,
  setActiveIngestCommand,
  setStreamEnabledCommand,
  setTicketAccessCommand,
  streamingUsageQuery,
  switchStreamProviderCommand,
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
// M6.10a: Cloudflare Stream as the second provider, per-session choice, RTMP overflow.
export {
  CLOUDFLARE_BACKUP_INGEST_URL,
  CLOUDFLARE_INGEST_URL,
  cloudflareStreamProvider,
} from './provider/cloudflare.ts';
export {
  FAKE_BACKUP_INGEST_URL,
  FAKE_CLOUDFLARE_BACKUP_INGEST_URL,
  FAKE_CLOUDFLARE_INGEST_URL,
  FAKE_CLOUDFLARE_KID,
  FAKE_INGEST_URL,
  FAKE_KID,
  fakePlaybackCheck,
  fakeVideoProvider,
} from './provider/fake.ts';
export { MAX_TOKEN_LENGTH } from './provider/jwt.ts';
export { MUX_BACKUP_INGEST_URL, MUX_INGEST_URL, muxVideoProvider } from './provider/mux.ts';
export {
  type LiveStream,
  type PlaybackClaims,
  VIDEO_PROVIDERS,
  type VideoProvider,
  type VideoProviderKind,
  type VideoProviderName,
  VideoUnavailableError,
} from './provider/port.ts';
export {
  configureVirtual,
  currentVideoProvider,
  verifyPlaybackAny,
  videoProvider,
  videoProviderFromEnv,
  videoProviders,
  videoProvidersFromEnv,
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
  linkZoomWebinarTx,
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
  zoomWebinarPlanTx,
} from './zoom.ts';
export { zoomEventKey, zoomParticipantKey, zoomSegmentKey } from './zoom-keys.ts';
// M6.10a: Zoom join/leave webhooks (verified on the raw body, deduplicated by provider event).
export {
  pairStays,
  processZoomWebhook,
  recordZoomParticipantCommand,
  signZoomWebhook,
  verifyZoomSignature,
  ZOOM_OUTCOMES,
  ZOOM_WEBHOOK_MAX_BYTES,
  ZOOM_WEBHOOK_TOLERANCE_MS,
  ZoomParticipantInput,
  type ZoomWebhookResult,
  zoomWebhookSecretFromEnv,
} from './zoom-webhook.ts';
