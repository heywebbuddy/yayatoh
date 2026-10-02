export {
  audienceOf,
  CampaignNameDto,
  campaignNamesQuery,
  campaignNamesTx,
  createCampaignCommand,
  deleteCampaignCommand,
  getCampaignQuery,
  listCampaignsQuery,
  saveCampaignCommand,
  setAudienceCommand,
} from './campaigns.ts';
export * from './client.ts';
// M6.1a: contact merges move this module's references (ADR 0022).
export { campaignsContactOwner } from './contact-merge.ts';
export { campaignsDataSubjects } from './data-subject.ts';
export { type CampaignBrand, renderCampaign } from './domain/render.ts';
export {
  type Allocation,
  allocate,
  DEFAULT_SCHEDULER,
  type OrgLane,
  ratePerMinute,
} from './domain/scheduler.ts';
export * from './dto.ts';
export { privateColumns } from './private-columns.ts';
export { campaignPreviewQuery, campaignResults, campaignResultsQuery } from './results.ts';
export {
  cancelCampaignCommand,
  estimateReachQuery,
  finalizeCampaignCommand,
  MAX_RECIPIENTS,
  pauseCampaignCommand,
  releaseChunkCommand,
  resumeCampaignCommand,
  scheduleCampaignCommand,
  sendNowCommand,
  sendPrefix,
  startScheduledCommand,
  TEST_SENDS_PER_HOUR,
  testPrefix,
  testSendCommand,
  unscheduleCampaignCommand,
} from './send.ts';
export {
  CAMPAIGN_EVENTS,
  campaignLanesTx,
  dueScheduledCampaignsTx,
  finalizableCampaignsTx,
  runOrgCampaigns,
} from './tick.ts';
// M6.1a: the person timeline's facts from this module (crm projection).
export { campaignsTimeline } from './timeline.ts';
