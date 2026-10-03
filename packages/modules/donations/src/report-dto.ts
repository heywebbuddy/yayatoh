import { z } from 'zod';
import { RECON_ITEM_KINDS, RECON_ITEM_STATUSES, RECON_PAYOUT_STATUSES } from './domain/reconcile.ts';
import { REPORT_SOURCES } from './domain/report.ts';

/** M4.8g: the donations report and its reconciliation, as the console reads them (allowlists). */
const Minor = z.int();
const Currency = z.string().regex(/^[A-Z]{3}$/);

export const ReportSourceEnum = z.enum(REPORT_SOURCES);

export const ReportTotalsDto = z.object({
  currency: Currency,
  onlineNetMinor: Minor,
  offlineMinor: Minor,
  ticketMinor: Minor,
  raisedMinor: Minor,
  feeCoverMinor: Minor,
  refundedMinor: Minor,
  pledgedMinor: Minor,
  pledgeCollectedMinor: Minor,
  writtenOffMinor: Minor,
  pledgeOpenMinor: Minor,
  matchedMinor: Minor,
  lineCount: z.int(),
  donorCount: z.int(),
  /** The ledger's memo entries for the event's gifts (signed sum). */
  ledgerMinor: Minor,
  /** The provider as the latest reconciliation saw it; null before the first. */
  providerMinor: Minor.nullable(),
  providerFeeMinor: Minor.nullable(),
});
export type ReportTotalsDto = z.infer<typeof ReportTotalsDto>;

export const DonationReportDto = z.object({
  eventId: z.uuid(),
  timeZone: z.string(),
  asOf: z.date(),
  totals: z.array(ReportTotalsDto),
  bySource: z.array(
    z.object({ source: ReportSourceEnum, currency: Currency, count: z.int(), netMinor: Minor }),
  ),
  byLevel: z.array(
    z.object({
      levelId: z.uuid().nullable(),
      name: z.string().nullable(),
      currency: Currency,
      giftCount: z.int(),
      giftNetMinor: Minor,
      pledgeCount: z.int(),
      pledgedMinor: Minor,
    }),
  ),
  byMatch: z.array(
    z.object({
      id: z.uuid(),
      sponsorName: z.string(),
      publicName: z.string().nullable(),
      campaignName: z.string(),
      ratioPercent: z.int(),
      capMinor: Minor,
      currency: Currency,
      status: z.enum(['active', 'closed', 'cancelled']),
      matchedMinor: Minor,
      giftCount: z.int(),
    }),
  ),
  byDonor: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      anonymous: z.boolean(),
      currency: Currency,
      count: z.int(),
      netMinor: Minor,
    }),
  ),
  /** True when the donor list was cut at `DONOR_ROWS_MAX` (the exports have everyone). */
  donorsTruncated: z.boolean(),
  pledges: z.array(
    z.object({
      currency: Currency,
      count: z.int(),
      pledgedMinor: Minor,
      cardMinor: Minor,
      linkMinor: Minor,
      offlineMinor: Minor,
      writtenOffMinor: Minor,
      openMinor: Minor,
    }),
  ),
});
export type DonationReportDto = z.infer<typeof DonationReportDto>;

export const ReconTotals = z.array(
  z.object({
    currency: Currency,
    ledgerMinor: Minor,
    providerMinor: Minor,
    feeMinor: Minor,
    /** The event's gifts on the charity's account that no payout has carried yet (net). */
    unpaidOutMinor: Minor,
    unpaidOutCount: z.int(),
  }),
);

export const ReconItemDto = z.object({
  id: z.uuid(),
  kind: z.enum(RECON_ITEM_KINDS),
  reference: z.string(),
  currency: Currency,
  ledgerMinor: Minor,
  providerMinor: Minor,
  /** provider − ledger */
  differenceMinor: Minor,
  status: z.enum(RECON_ITEM_STATUSES),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.date().nullable(),
});
export type ReconItemDto = z.infer<typeof ReconItemDto>;

export const ReconPayoutDto = z.object({
  payoutId: z.string(),
  status: z.enum(RECON_PAYOUT_STATUSES),
  amountMinor: Minor,
  currency: Currency,
  arrivalDate: z.string(),
  donationGrossMinor: Minor,
  donationFeeMinor: Minor,
  donationNetMinor: Minor,
  donationCount: z.int(),
});
export type ReconPayoutDto = z.infer<typeof ReconPayoutDto>;

export const DonationReconciliationDto = z.object({
  /** Whether the org takes gifts on a connected account (otherwise there is nothing to compare). */
  connected: z.boolean(),
  lastRun: z
    .object({
      id: z.uuid(),
      ranAt: z.date(),
      ledgerCount: z.int(),
      providerCount: z.int(),
      itemCount: z.int(),
      totals: ReconTotals,
    })
    .nullable(),
  items: z.array(ReconItemDto),
  payouts: z.array(ReconPayoutDto),
});
export type DonationReconciliationDto = z.infer<typeof DonationReconciliationDto>;
