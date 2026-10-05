// M6.2b: attribution, the curated explorer, organizer alert rules, scheduled reports.
export { actorCanTx } from './access.ts';
export {
  ATTRIBUTION_MODELS,
  type AttributableOrder,
  type AttributionModel,
  AttributionRow,
  attributionRowsOf,
  creditTouches,
  foldAttribution,
  ORDER_CREDIT_BPS,
  type PathTouch,
  splitEvenly,
} from './attribution/models.ts';
export {
  BACKFILL_ACTOR,
  BACKFILL_DEFAULTS,
  BackfillRunDto,
  backfillOrgNow,
  backfillStatusQuery,
  type PageResult,
  runBackfill,
  runBackfillPage,
  startBackfillCommand,
} from './backfill.ts';
export { computeEventSnapshotTx, dayIn, foldDaily, hashSnapshot } from './compute.ts';
export {
  addDays,
  bucketOf,
  bucketsBetween,
  buildCounts,
  buildRevenue,
  CountFigures,
  DashboardInput,
  DEFAULT_RANGE_DAYS,
  dashboardQueries,
  daysBetween,
  GRANULARITIES,
  type Granularity,
  MAX_RANGE_DAYS,
  noShowsOf,
  OrgDashboardDto,
  OrgRevenueDto,
  orgDashboardQuery,
  orgRevenueQuery,
  resolveRange,
  TOP_EVENTS,
  topEventCounts,
  topEventRevenue,
} from './dashboard.ts';
export {
  COUNT_MEASURES,
  type CountMeasure,
  comboProblem,
  DIMENSIONS as EXPLORER_DIMENSIONS,
  type Dimension as ExplorerDimension,
  isAttributionMeasure,
  isMoneyMeasure,
  MEASURES,
  type Measure,
  MONEY_MEASURES,
  type MoneyMeasure,
  PRESET_DAYS,
  RANGE_PRESETS,
  type RangePreset,
  TOUCH_DIMENSIONS,
} from './explorer/catalog.ts';
export {
  csvValue,
  currencyDigits,
  decimalOf,
  EXPLORE_CSV_COLUMNS,
  type ExploreCsvColumn,
  ExploreCsvRow,
  exploreCsv,
  exploreCsvSerializer,
} from './explorer/csv.ts';
export {
  ExploreDto,
  ExploreInput,
  ExploreMoneyInput,
  ExploreRowDto,
  exploreMoneyQuery,
  exploreQuery,
  exploreRange,
  explorerQueries,
  exploreTx,
  MAX_ROWS as EXPLORE_MAX_ROWS,
} from './explorer/explore.ts';
export {
  deleteViewCommand,
  listSavedViewsQuery,
  MAX_VIEWS_PER_MEMBER,
  SavedViewDto,
  saveViewCommand,
} from './explorer/views.ts';
export {
  applyUnpublishedWarehouseEvents,
  catchUpWarehouse,
  type IngestOutcome,
  ingestEventTx,
  WAREHOUSE_CONSUMER,
  WAREHOUSE_EVENT_SCHEMAS,
  WAREHOUSE_EVENTS,
  type WarehouseEventKey,
  warehouseIngestor,
} from './ingest.ts';
export { privateColumns } from './private-columns.ts';
export {
  MAX_CATCH_UP,
  MAX_RECIPIENTS,
  MAX_RUN_ATTEMPTS,
  REPORT_FREQUENCIES,
  type ReportFrequency,
} from './reports/catalog.ts';
export { fill, REPORT_LABELS, REPORT_LOCALES, type ReportLocale, reportLocale } from './reports/labels.ts';
export {
  duePeriods,
  periodContaining,
  periodDueAt,
  periodOfKey,
  type ReportPeriod,
} from './reports/period.ts';
export {
  dueReportsTx,
  periodLabel,
  REPORT_KIND,
  type ReportDeps,
  type RunOutcome,
  reportHtml,
  runDueReports,
  runReportPeriod,
} from './reports/run.ts';
export {
  createReportScheduleCommand,
  deleteReportScheduleCommand,
  getReportScheduleQuery,
  listReportRunsQuery,
  listReportSchedulesQuery,
  nextSendAt,
  ReportRunDto,
  ReportScheduleDto,
  reportFileQuery,
  setReportScheduleEnabledCommand,
  updateReportScheduleCommand,
} from './reports/schedules.ts';
export {
  isRuleMoney,
  RULE_CONDITIONS,
  RULE_MEASURES,
  RULE_SEVERITIES,
  RULE_WINDOWS,
  type RuleCondition,
  type RuleMeasure,
} from './rules/catalog.ts';
export { changePct, measureValue, ruleFires } from './rules/evaluate.ts';
export {
  AlertRuleDto,
  alertRuleCommands,
  createAlertRuleCommand,
  deleteAlertRuleCommand,
  evaluateAlertRulesTx,
  evaluateRuleTx,
  getAlertRuleQuery,
  listAlertRulesQuery,
  RULE_EVALUATED_EVENT,
  RuleEvaluatedPayload,
  ruleWindowValuesTx,
  setAlertRuleEnabledCommand,
  updateAlertRuleCommand,
} from './rules/rules.ts';
export {
  BACKFILL_STATUSES,
  type BackfillStatus,
  DAILY_METRICS,
  type DailyMetric,
  WAREHOUSE_ADAPTERS,
  type WarehouseAdapterName,
} from './schema.ts';
export { orgTimeZoneTx, type SyncResult, syncEventTx } from './sync.ts';
export { analyticsOrgTick } from './tick.ts';
export {
  type AnalyticsWarehouse,
  type AttributionRange,
  type AttributionTotal,
  type DailyRow,
  type DailyTotal,
  type DayRange,
  EventSnapshot,
  EventState,
  type EventStateRow,
  type EventTotal,
  scopeOrg,
  sortDaily,
  type WarehouseScope,
  type WriteResult,
} from './warehouse/port.ts';
export { diffAttribution, diffDaily, postgresWarehouse } from './warehouse/postgres.ts';
export { configuredWarehouseName, lazyWarehouse, warehouseFromEnv } from './warehouse/select.ts';
export {
  SNAPSHOT_MARKER,
  signPipeToken,
  TINYBIRD_DATASOURCES,
  TINYBIRD_PIPES,
  type TinybirdConfig,
  TinybirdError,
  tinybirdWarehouse,
} from './warehouse/tinybird.ts';
export { type FakeTinybird, type FakeTinybirdCall, fakeTinybird } from './warehouse/tinybird-fake.ts';
