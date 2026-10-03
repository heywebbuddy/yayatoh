// M5.1d: print a badge with a balance due (audited override).
export { OVERRIDE_MINUTES, overrideAllows, overrideBalanceDueCommand } from './balance-override.ts';
export {
  BatchDto,
  type BatchRunDeps,
  type BatchSlice,
  badgeTicketsQuery,
  batchFileByLink,
  batchFileKey,
  batchLinkQuery,
  batchPartsQuery,
  CHUNK_SIZE,
  cancelBatchCommand,
  failBatchCommand,
  finishBatchCommand,
  listBatchesQuery,
  MAX_BATCH_BADGES,
  nextBatchChunkCommand,
  runBadgeBatch,
  singleBadgeQuery,
  startBatchCommand,
  storeBatchChunkCommand,
} from './batches.ts';
export * from './client.ts';
export { LINK_TTL_MS, signBatchLink, verifyBatchLink } from './link.ts';
export { privateColumns } from './private-columns.ts';
export { type BadgesHtmlInput, badgesHtml } from './render.ts';
export { samplePreviewQuery } from './sample.ts';
export { BATCH_STATUSES, type BatchStatus } from './schema.ts';
export {
  AssignmentDto,
  assignTemplateCommand,
  BadgeQuestionDto,
  BadgesSetupDto,
  badgeQuestionsTx,
  badgesSetupQuery,
  createTemplateCommand,
  deleteTemplateCommand,
  MAX_TEMPLATES_PER_EVENT,
  saveTemplateCommand,
  setDefaultTemplateCommand,
  TemplateDto,
} from './templates.ts';
