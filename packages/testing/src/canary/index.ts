// Pure canary-leak tooling (roadmap §9): the column-privacy registry, the matcher and the crawler.
// No database: the e2e crawler and unit tests import this; `canaryOrg()` lives in the main entry.
export {
  DEVICE_API_ALLOW,
  DOOR_ALLOW,
  EXPORT_ALLOW,
  GUEST_SITE_ALLOW,
  ME_ALLOW,
  ME_IDENTITY_ALLOW,
  OPS_ALLOW,
  PARTY_ALLOW,
  PORTAL_API_ALLOW,
  V1_ALLOW,
} from './allowlists.ts';
export { type CoverageProblem, columnCoverage, type Snapshot, TEXTUAL } from './coverage.ts';
export { type CrawlOptions, type CrawlResult, crawl, extractLinks, type Fetched } from './crawl.ts';
export {
  allowed,
  findCanaries,
  formatLeaks,
  type Hit,
  type Leak,
  type LeakClass,
  leaksIn,
  type Surface,
} from './matcher.ts';
export {
  COLUMN_PRIVACY,
  type ColumnId,
  canaryToken,
  codeColumns,
  isPrivate,
  PHONE_PREFIX,
  PLANTED_SECRETS,
  phoneColumns,
  privateColumnList,
  type RegisteredColumn,
  type RegisteredPrivateColumn,
  registeredColumns,
  seedOf,
} from './registry.ts';
