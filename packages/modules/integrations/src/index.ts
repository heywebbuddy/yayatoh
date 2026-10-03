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
  type WriteMeta,
} from './sdk/connector.ts';
// M6.4d: Mailchimp, Klaviyo and HubSpot (consent-first audience and contact sync).
export * from './audience/consent.ts';
export { type ListApi, MEMBERS, type ProviderList } from './audience/list-connector.ts';
export {
  AudienceSyncDto,
  audienceSyncQuery,
  audienceSyncSerializer,
  CONSENT_CHANGES_SHOWN,
  ConsentChangeDto,
  consentChangesQuery,
  consentChangesSerializer,
  isListConnector,
  isMarketingConnector,
  LIST_CONNECTORS,
  MARKETING_CONNECTORS,
  providerLists,
  saveAudienceSyncCommand,
} from './audience/settings.ts';
export { type ContactState, contactStatesTx } from './audience/state.ts';
export { hubspotConnector, parseHubspotContact } from './connectors/hubspot/index.ts';
export {
  HUBSPOT_SEED_CONTACT,
  HUBSPOT_SEED_OPTED_OUT,
  hubspotFakeProvider,
  hubspotRemoteContacts,
  hubspotRemoteEdit,
  hubspotRemoteEvents,
  hubspotRemoteOptOut,
} from './connectors/hubspot/fake.ts';
export { klaviyoApi, klaviyoConnector, klaviyoStatus, parseKlaviyoProfile } from './connectors/klaviyo/index.ts';
export {
  KLAVIYO_LISTS,
  KLAVIYO_SEED_BOUNCED,
  klaviyoFakeProvider,
  klaviyoRemoteMembers,
  klaviyoRemoteSet,
} from './connectors/klaviyo/fake.ts';
export { mailchimpApi, mailchimpConnector, parseMailchimpMember } from './connectors/mailchimp/index.ts';
export {
  MAILCHIMP_LISTS,
  MAILCHIMP_SEED_UNSUBSCRIBED,
  mailchimpFakeProvider,
  mailchimpRemoteMembers,
  mailchimpRemoteSet,
  subscriberHash,
} from './connectors/mailchimp/fake.ts';
export { integrationsContactOwner } from './contact-merge.ts';
