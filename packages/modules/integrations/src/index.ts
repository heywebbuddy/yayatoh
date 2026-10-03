// M6.5d: accounting (daily summary journals to QuickBooks Online and Xero).
export * from './accounting/domain.ts';
export {
  AccountingDetailDto,
  AccountMapDto,
  accountingDetailQuery,
  accountingDetailSerializer,
  currentAccountMapTx,
  JOURNALS_OBJECT,
  JournalDto,
  journalRecordKey,
  prepareJournalsCommand,
  RECENT_JOURNALS,
  recordJournalResultsCommand,
  saveAccountMapCommand,
} from './accounting/journals.ts';
export { chartOfAccounts, postAccounting } from './accounting/run.ts';
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
  providerHeaderName,
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
export {
  type FakeBooksJournal,
  QUICKBOOKS_FAKE_ACCOUNTS,
  quickbooksConnector,
  quickbooksFakeProvider,
  quickbooksJournals,
} from './connectors/quickbooks.ts';
export { XERO_FAKE_ACCOUNTS, xeroConnector, xeroFakeProvider, xeroJournals } from './connectors/xero.ts';
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
  type AccountingSide,
  type ConnectorDefinition,
  defineConnector,
  type JournalToPost,
  type LocalRecord,
  mappingFields,
  type ObjectDefinition,
  type Page,
  type PullSide,
  type PushSide,
  type RemoteRecord,
  type SyncIO,
} from './sdk/connector.ts';
