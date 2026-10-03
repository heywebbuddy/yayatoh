export {
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  type FakeAccount,
  type FakeProvider,
  fakeIntegrationAuth,
  fakeIntegrations,
  safeReturnPath,
} from './auth/fake.ts';
export { type NangoOptions, nangoIntegrationAuth } from './auth/nango.ts';
export {
  type AuthRef,
  type AuthStatus,
  type BeginConnect,
  type IntegrationAuth,
  isProviderError,
  type ProviderClient,
  ProviderError,
  type ProviderRequest,
  type ProviderResponse,
  type ResolvedConnection,
  redactSecrets,
} from './auth/port.ts';
export { fakeAuthForConnectors, integrationAuthFromEnv } from './auth/registry.ts';
export {
  beginConnectCommand,
  CONNECT_STATE_TTL_MS,
  ConnectionDetailDto,
  ConnectionDto,
  completeConnectCommand,
  connectionDetailQuery,
  connectionDetailSerializer,
  connectionSerializer,
  currentMappingsTx,
  disconnectCommand,
  failConnectCommand,
  listConnectionsQuery,
  MappingDto,
  parseRules,
  pendingConnectionQuery,
  RECENT_RUNS,
  RunDto,
  requestSyncCommand,
  requireConnector,
  resetCursorsTx,
  setConnectionPausedCommand,
  setSyncIntervalCommand,
} from './connections.ts';
export {
  DEMO_BAD_RECORD,
  DEMO_SEED,
  demoConnector,
  demoFakeProvider,
  demoRemoteRecords,
  demoRemoteUpdate,
} from './connectors/demo.ts';
export { CONNECTORS, connectorByKey, offeredConnectors } from './connectors/index.ts';
// M6.9b: the Zoom connector and its fake API's dev controls.
export {
  ZOOM_REPORT_PAGE,
  zoomConnector,
  zoomFakeAttend,
  zoomFakeProvider,
  zoomFakeRegistrants,
  zoomFakeWebinar,
} from './connectors/zoom.ts';
export * from './domain/mapping.ts';
export * from './domain/sync.ts';
export {
  CONNECTION_REVOKED_EVENT,
  claimRunCommand,
  connectionsWithWorkTx,
  finishRunCommand,
  MAX_PAGES,
  PUSH_PAGE,
  pullPageCommand,
  pushPageCommand,
  runDueSyncs,
  runSync,
  SYNC_ACTOR,
  SYNC_COMPLETED_EVENT,
  SYNC_PERMISSION,
  SyncCompletedPayload,
  type SyncDeps,
  type SyncResult,
} from './engine.ts';
export {
  dismissErrorsCommand,
  ErrorDto,
  ErrorGroupDto,
  errorGroupsSerializer,
  GROUP_ROWS,
  listErrorGroupsQuery,
  openErrorCountQuery,
  retryErrorsCommand,
} from './errors.ts';
export { mappingVersionsQuery, saveMappingCommand } from './mappings.ts';
export { privateColumns } from './private-columns.ts';
export {
  type ConnectorDefinition,
  defineConnector,
  type LocalRecord,
  mappingFields,
  type ObjectDefinition,
  type Page,
  type PullSide,
  type PushSide,
  type RemoteRecord,
  type SyncIO,
} from './sdk/connector.ts';
// M6.10a: create a session's Zoom webinar from Yayatoh through the org's Zoom connection.
export {
  activeZoomConnectionTx,
  createZoomWebinar,
  recordCreatedZoomWebinarCommand,
  ZoomWebinarPlanDto,
  zoomConnectedQuery,
  zoomWebinarPlanQuery,
} from './zoom-webinars.ts';
