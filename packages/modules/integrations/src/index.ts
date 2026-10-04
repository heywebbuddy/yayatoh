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
export {
  EB_EVENTS_PAGE,
  EB_ORDERS_PAGE,
  eventbriteFakeProvider,
  eventbriteRemoteRefund,
  eventbriteRemoteRename,
  eventbriteRequests,
} from './connectors/eventbrite/fake.ts';
export {
  EB_EVENTS,
  EB_ORDERS,
  EB_ORGANIZATION,
  EVENTBRITE_FIXTURE_COUNTS,
} from './connectors/eventbrite/fixture.ts';
export {
  EVENTBRITE,
  eventbriteConnector,
  eventbriteOrganization,
} from './connectors/eventbrite/index.ts';
export {
  alreadyImportedQuery,
  eventbritePreview,
  ImportPreviewDto,
  ImportResultDto,
  importPreviewSerializer,
  importResultQuery,
  importTargetQuery,
} from './connectors/eventbrite/preview.ts';
export {
  CALENDAR_ID,
  calendarEventId,
  type FakeCalendarEvent,
  fakeCalendarAllEvents,
  fakeCalendarEvents,
  googleCalendarConnector,
  googleCalendarFakeProvider,
  googleCalendarPersonalConnector,
} from './connectors/google-calendar.ts';
export {
  googleSheetsFakeProvider,
  type SheetRow,
  sheetsRemoteAdd,
  sheetsRemoteDelete,
  sheetsRemoteEdit,
  sheetsRemoteList,
  sheetsRemoteRows,
} from './connectors/google-sheets/fake.ts';
export {
  GOOGLE_SHEETS,
  googleSheetsConnector,
  rowRecordId,
  SHEET_COLUMNS,
  type SheetScope,
} from './connectors/google-sheets/index.ts';
export {
  linkEventSheet,
  linkSheetCommand,
  SheetLinkDto,
  sheetLinksQuery,
  sheetLinksSerializer,
  sheetLinkTargetQuery,
  sheetUrl,
  unlinkSheetCommand,
} from './connectors/google-sheets/links.ts';
export { CONNECTORS, connectorByKey, offeredConnectors } from './connectors/index.ts';
// M6.4b: the Eventbrite importer and Google Sheets live sync.
export { linkedLocalIdTx } from './connectors/links.ts';
export {
  type FakeBooksJournal,
  QUICKBOOKS_FAKE_ACCOUNTS,
  quickbooksConnector,
  quickbooksFakeProvider,
  quickbooksJournals,
} from './connectors/quickbooks.ts';
// M6.5b: Salesforce (contacts and leads, campaign members per event, sponsor opportunities).
export {
  SALESFORCE_BAD_RECORD,
  SALESFORCE_SEED,
  SF_HUMAN_USER,
  SF_INTEGRATION_USER,
  type SfRecord,
  salesforceFakeProvider,
  salesforceRemoteEdit,
  salesforceRemoteRecords,
} from './connectors/salesforce/fake.ts';
export { salesforceConnector } from './connectors/salesforce/index.ts';
export {
  campaignStatus,
  dateIn,
  joinName,
  NO_LAST_NAME,
  opportunityStage,
  SALESFORCE,
  SF_EXTERNAL_ID,
  type SObject,
  splitName,
} from './connectors/salesforce/objects.ts';
export { slackConnector } from './connectors/slack.ts';
export { XERO_FAKE_ACCOUNTS, xeroConnector, xeroFakeProvider, xeroJournals } from './connectors/xero.ts';
export { integrationsDataSubjects } from './data-subject.ts';
export * from './domain/calendar.ts';
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
  REMOVE_SWEEP,
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
export { linkedCountsQuery } from './linked.ts';
export { mappingVersionsQuery, saveMappingCommand } from './mappings.ts';
export {
  beginPersonalCalendarCommand,
  completePersonalCalendarCommand,
  failPersonalCalendarCommand,
  PERSONAL_CALENDAR_STATES,
  PersonalCalendarDto,
  pendingPersonalCalendarQuery,
  personalCalendarQuery,
  personalCalendarSerializer,
  stopPersonalCalendarCommand,
  syncPersonalCalendarCommand,
} from './personal.ts';
export { privateColumns } from './private-columns.ts';
export {
  type AccountingSide,
  type ConnectorDefinition,
  defineConnector,
  isImporter,
  type JournalToPost,
  type LocalRecord,
  mappingFields,
  type ObjectDefinition,
  type Page,
  type PullSide,
  type PushScope,
  type PushSide,
  type RemoteRecord,
  type SyncIO,
  type WriteMeta,
} from './sdk/connector.ts';
export {
  isSlackChannelId,
  listSlackChannels,
  postSlackMessage,
  type SlackChannel,
  slackAuthTest,
} from './slack/api.ts';
export { digestFactsTx } from './slack/digest.ts';
export {
  claimSlackMessagesCommand,
  finishSlackMessageCommand,
  MAX_SLACK_ATTEMPTS,
  queueSlackDigestsCommand,
  runSlackDispatch,
  SLACK_ACTOR,
  SLACK_PERMISSION,
  type SlackDeps,
  type SlackDispatchResult,
  STALE_DIGEST_MS,
} from './slack/dispatch.ts';
export {
  FAKE_SLACK_CHANNELS,
  type FakeSlackMessage,
  fakeSlackMessages,
  slackFakeProvider,
} from './slack/fake.ts';
export {
  DIGEST_EVENT_LINES,
  type DigestFacts,
  digestAmounts,
  escapeMrkdwn,
  renderSlackAlert,
  renderSlackDigest,
  renderSlackTest,
  SLACK_MESSAGES,
  SLACK_SEVERITIES,
  type SlackBlock,
  type SlackMessage,
  type SlackSeverity,
  slackPiiProblems,
  slackText,
} from './slack/render.ts';
export { addDays, DIGEST_TIME, dayBounds, localDay, nextDigestAt } from './slack/schedule.ts';
export {
  queueSlackTestCommand,
  RECENT_SLACK_MESSAGES,
  SLACK_CONNECTOR,
  SlackMessageDto,
  SlackPanelDto,
  SlackSettingsDto,
  saveSlackSettingsCommand,
  slackAuthRefQuery,
  slackChannelsFor,
  slackPanelQuery,
  slackPanelSerializer,
} from './slack/settings.ts';
export { ALERT_NOTIFIED_EVENT, AlertNotifiedPayload, slackAlertsSubscriber } from './slack/subscriber.ts';
export {
  ZAPIER_ACTIONS,
  ZAPIER_EVENT_PICKER,
  ZAPIER_SCOPES,
  ZAPIER_TRIGGERS,
  type ZapierPart,
} from './zapier.ts';
