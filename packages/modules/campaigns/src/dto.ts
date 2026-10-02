import { TEMPLATE_KEYS } from '@yayatoh/audiences';
import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { CAMPAIGN_CHANNELS, CampaignContent } from './domain/blocks.ts';
import { CAMPAIGN_STATUSES, EXCLUSION_REASONS } from './domain/lifecycle.ts';

export const CampaignName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(120));

/** The campaign's audience: a saved segment, or one of the M3.6a templates with its parameters. */
export const AudienceChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('segment'), segmentId: z.uuid() }),
  z.object({
    kind: z.literal('template'),
    templateKey: z.enum(TEMPLATE_KEYS),
    eventId: z.uuid(),
    ticketTypeIds: z.array(z.uuid()).max(50).default([]),
  }),
]);
export type AudienceChoice = z.infer<typeof AudienceChoice>;

export const CampaignSummaryDto = z.object({
  id: z.uuid(),
  name: z.string(),
  channel: z.enum(CAMPAIGN_CHANNELS),
  status: z.enum(CAMPAIGN_STATUSES),
  scheduledAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  updatedAt: z.date(),
  /** Recipients in the snapshot who get it (null before the send starts). */
  recipients: z.int().nullable(),
});
export type CampaignSummaryDto = z.infer<typeof CampaignSummaryDto>;
export const campaignSummarySerializer = defineSerializer('campaigns.summary', CampaignSummaryDto);

export const CampaignDto = z.object({
  id: z.uuid(),
  name: z.string(),
  channel: z.enum(CAMPAIGN_CHANNELS),
  status: z.enum(CAMPAIGN_STATUSES),
  locale: z.string(),
  /** Null when a stored draft no longer validates (it must be fixed before sending). */
  content: CampaignContent.nullable(),
  audience: AudienceChoice.nullable(),
  scheduledAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  pausedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CampaignDto = z.infer<typeof CampaignDto>;
export const campaignSerializer = defineSerializer('campaigns.campaign', CampaignDto);

export const ReasonCountDto = z.object({ reason: z.enum(EXCLUSION_REASONS), count: z.int() });

/** Who the campaign would reach now (before sending) or reached (the snapshot). */
export const ReachDto = z.object({
  total: z.int(),
  eligible: z.int(),
  excluded: z.array(ReasonCountDto),
});
export type ReachDto = z.infer<typeof ReachDto>;

export const CampaignResultsDto = z.object({
  reach: ReachDto,
  /** Recipients still waiting for the scheduler, and those handed to the dispatcher. */
  pending: z.int(),
  released: z.int(),
  sent: z.int(),
  waiting: z.int(),
  notSent: z.int(),
  failed: z.int(),
  delivered: z.int(),
  bounced: z.int(),
  complained: z.int(),
  unsubscribed: z.int(),
  /** Opens are not tracked (no tracking pixel): always null for now. */
  opened: z.int().nullable(),
  clicked: z.int(),
  clickDevices: z.int(),
  /** Why messages wait or were not sent at the gate (consent, quiet hours, quota, suppressed…). */
  reasons: z.array(z.object({ channel: z.string(), reason: z.string(), count: z.int() })),
});
export type CampaignResultsDto = z.infer<typeof CampaignResultsDto>;
export const campaignResultsSerializer = defineSerializer('campaigns.results', CampaignResultsDto);

export const PreviewDto = z.object({
  subject: z.string(),
  preheader: z.string(),
  html: z.string(),
  text: z.string(),
  sms: z.string().nullable(),
  dir: z.enum(['ltr', 'rtl']),
});
export type PreviewDto = z.infer<typeof PreviewDto>;
