// M6.1a: contact merges move this module's references (ADR 0022).
export { participationContactOwner } from './contact-merge.ts';
export * from './domain/templates.ts';
export {
  AUDIENCE_EXPORT_COLUMNS,
  audienceExportAction,
  audienceExportBulk,
  CONSENT_WORDS,
} from './export.ts';
export { assertMoneyConditionsAllowedTx } from './money.ts';
export { PersonTimelineDto, personTimelineQuery } from './people.ts';
export { privateColumns } from './private-columns.ts';
export {
  catchUpParticipation,
  PARTICIPATION_EVENTS,
  participationProjector,
  participationTargetTx,
  refreshParticipationTx,
} from './projector.ts';
export { compileForOrgTx } from './scopes.ts';
export {
  AudiencePreviewDto,
  AudienceRowDto,
  deleteSegmentCommand,
  getSegmentQuery,
  listSegmentsQuery,
  previewAudienceQuery,
  SegmentDto,
  SegmentName,
  SegmentSummaryDto,
  saveSegmentCommand,
  segmentDefinitionTx,
} from './segments.ts';
export {
  CampaignOpenedPayload,
  CONTACT_SIGNAL_EVENTS,
  catchUpContactSignals,
  contactSignalOf,
  contactSignalsSubscriber,
  RESCORE_PAGE,
  refreshContactStatsTx,
  rescoreOrgContacts,
  SessionAttendedPayload,
} from './stats.ts';
