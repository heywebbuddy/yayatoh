import { z } from 'zod';
import {
  CAMPAIGN_STATUSES,
  DISPLAY_AS,
  GIFT_SOURCES,
  GIFT_STATUSES,
  TRIBUTE_KINDS,
} from './domain/giving.ts';

const Money = z.int().positive().max(100_000_000);
const Text = (max: number) => z.string().trim().min(1).max(max);
const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const CampaignInput = z.object({
  eventId: z.uuid(),
  name: Text(120),
  description: OptionalText(2000),
  goalMinor: Money,
  minGiftMinor: Money.optional(),
  maxGiftMinor: Money.optional(),
});

export const UpdateCampaignInput = CampaignInput.extend({
  campaignId: z.uuid(),
  minGiftMinor: Money,
  maxGiftMinor: Money,
  status: z.enum(CAMPAIGN_STATUSES),
});

export const LevelInput = z.object({
  eventId: z.uuid(),
  campaignId: z.uuid(),
  name: Text(80),
  amountMinor: Money,
  description: OptionalText(200),
});

export const LevelDto = z.object({
  id: z.uuid(),
  name: z.string(),
  amountMinor: z.int(),
  description: z.string().nullable(),
});
export type LevelDto = z.infer<typeof LevelDto>;

/** A campaign as its host sees it: settings, levels and totals of paid gifts. */
export const CampaignDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  goalMinor: z.int(),
  currency: z.string(),
  minGiftMinor: z.int(),
  maxGiftMinor: z.int(),
  status: z.enum(CAMPAIGN_STATUSES),
  levels: z.array(LevelDto),
  /** Paid gifts: their sum (without fee covers), their count, and the fees donors covered. */
  raisedMinor: z.int(),
  giftCount: z.int(),
  feeCoverMinor: z.int(),
});
export type CampaignDto = z.infer<typeof CampaignDto>;

/**
 * A gift in the host's list (P4-13): the name only as the donor chose it (`shownName` null =
 * Anonymous); the donor's own name and email are in the step-up CSV export only.
 */
export const HostGiftDto = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  levelName: z.string().nullable(),
  status: z.enum(GIFT_STATUSES),
  amountMinor: z.int(),
  feeCoverMinor: z.int(),
  currency: z.string(),
  shownName: z.string().nullable(),
  tribute: z.object({ kind: z.enum(TRIBUTE_KINDS), name: z.string() }).nullable(),
  createdAt: z.date(),
  paidAt: z.date().nullable(),
});
export type HostGiftDto = z.infer<typeof HostGiftDto>;

export const DonationsConsoleDto = z.object({
  /** Online giving works only with an enabled connected account (P4-9). */
  connected: z.boolean(),
  campaigns: z.array(CampaignDto),
  /** Paid gifts, newest first (at most 500). */
  gifts: z.array(HostGiftDto),
  /** Gifts started but not paid yet. */
  pendingCount: z.int(),
});
export type DonationsConsoleDto = z.infer<typeof DonationsConsoleDto>;

/**
 * The giving page (public). Campaign text, levels and totals only: no donor, no gift, no
 * per-gift amount ever (P4-13). Allowlist serializer: anything else is stripped.
 */
export const PublicCampaignDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  goalMinor: z.int(),
  currency: z.string(),
  minGiftMinor: z.int(),
  maxGiftMinor: z.int(),
  raisedMinor: z.int(),
  giftCount: z.int(),
  levels: z.array(LevelDto),
});
export type PublicCampaignDto = z.infer<typeof PublicCampaignDto>;

export const PublicGivingDto = z.object({
  /** false: the org has no enabled connected account; the page says giving is unavailable. */
  available: z.boolean(),
  campaigns: z.array(PublicCampaignDto),
  processingFee: z.object({ percentBps: z.int(), fixedMinor: z.int() }),
});
export type PublicGivingDto = z.infer<typeof PublicGivingDto>;

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const StartGiftInput = z
  .object({
    eventId: z.uuid(),
    campaignId: z.uuid(),
    /** A level, or an own amount (exactly one). */
    levelId: z.uuid().nullish(),
    amountMinor: z.int().positive().max(100_000_000).nullish(),
    coverFee: z.boolean().default(false),
    donor: z.object({ name: Text(120), email: Email }),
    displayAs: z.enum(DISPLAY_AS),
    employer: OptionalText(120),
    tribute: z
      .object({
        kind: z.enum(TRIBUTE_KINDS),
        name: Text(120),
        recipient: OptionalText(120),
        note: OptionalText(500),
      })
      .nullish()
      .transform((v) => v ?? null),
    locale: z.string().min(2).max(10).default('en'),
    /** M4.8d: thank me by name on the room's screen (P4-13; off by default, never when anonymous). */
    showOnScreen: z.boolean().default(false),
    /** M4.8d: the giving page opened from a QR code (screen or table card) records `qr`. */
    source: z.enum(GIFT_SOURCES).default('online'),
  })
  .refine((v) => Boolean(v.levelId) !== Boolean(v.amountMinor), {
    message: 'Choose a level or an amount',
    path: ['amount'],
  });

/** Server only: what the web needs to create the provider payment (never sent to the browser). */
export const StartGiftResultDto = z.object({
  giftId: z.uuid(),
  orderId: z.uuid(),
  /** The thank-you page's link token (signed gift id). */
  giftToken: z.string(),
  amountMinor: z.int(),
  feeCoverMinor: z.int(),
  totalMinor: z.int(),
  currency: z.string(),
  buyerEmail: z.string(),
  campaignName: z.string(),
  payment: z.object({
    fundsFlow: z.literal('organizer_mor'),
    connectedAccountId: z.string(),
    applicationFeeMinor: z.literal(0),
  }),
});
export type StartGiftResultDto = z.infer<typeof StartGiftResultDto>;

/** What the thank-you page shows (reached with the signed gift link): no donor data. */
export const GiftReceiptDto = z.object({
  status: z.enum(GIFT_STATUSES),
  campaignName: z.string(),
  amountMinor: z.int(),
  feeCoverMinor: z.int(),
  currency: z.string(),
});
export type GiftReceiptDto = z.infer<typeof GiftReceiptDto>;
