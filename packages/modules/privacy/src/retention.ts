import { redactAttendeesForEventsTx } from '@yayatoh/attendees';
import { purgeScansBeforeTx } from '@yayatoh/checkin';
import { eventIdsEndedBeforeTx } from '@yayatoh/events';
import { eraseResponsesDsarTx } from '@yayatoh/forms';
import { redactAbandonedOrdersTx } from '@yayatoh/orders';
import {
  clearFinishedBulkParamsTx,
  purgeExpiredFilesTx,
  purgeExpiredIdempotencyKeysTx,
  tenantCommand,
} from '@yayatoh/platform';
import { purgeHolderLinksTx, redactHoldersForEventsTx, redactStaleClaimsTx } from '@yayatoh/ticketing';
import { z } from 'zod';

const DAY = 86_400_000;

/**
 * Retention defaults (roadmap §10 "Retention default" table; values not in the table are
 * Claude Code's proposals). All pending the owner's confirmation (docs/owner-inbox.md, M1.14).
 */
export const RETENTION = {
  /** Attendee PII: 24 months after the event (roadmap). Attendees and ticket holders are redacted. */
  attendeePiiAfterEventDays: 730,
  /** Check-in logs: 12 months (roadmap). The scan log is deleted; admissions (counts) stay. */
  scanLogDays: 365,
  /** Checkouts never paid: buyer name/email and answers removed after 30 days (proposal). */
  abandonedCheckoutDays: 30,
  /** Holder magic links: deleted 30 days after they expire (proposal). */
  holderLinkDaysAfterExpiry: 30,
  /** Unclaimed ticket-claim links: the recipient address is removed 90 days after expiry (proposal). */
  claimDaysAfterExpiry: 90,
  /** Finished bulk operations: parameters cleared after 30 days; data-subject exports after 1 day. */
  bulkParamsDays: 30,
  dsarExportParamsDays: 1,
  /** Idempotency records: a day past expiry. */
  idempotencyDaysAfterExpiry: 1,
  /** Generated files (exports) expire after 7 days (bulk framework); deleted once expired. */
} as const;

export const RetentionResult = z.object({
  files: z.int(),
  bulkParams: z.int(),
  idempotencyKeys: z.int(),
  abandonedOrders: z.int(),
  holderLinks: z.int(),
  claims: z.int(),
  scans: z.int(),
  attendees: z.int(),
  ticketHolders: z.int(),
});
export type RetentionResult = z.infer<typeof RetentionResult>;

/**
 * One org's retention pass (the worker runs it daily per org as a system actor). Idempotent:
 * redacted rows are skipped next time. Audited with counts only.
 */
export const retentionCommand = tenantCommand({
  name: 'privacy.retention',
  input: z.object({}),
  output: RetentionResult,
  entitlement: 'core',
  permission: 'platform:privacy.retention',
  handler: async ({ ctx, tx }) => {
    const now = ctx.now;
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const abandoned = await redactAbandonedOrdersTx(tx, ago(RETENTION.abandonedCheckoutDays), now);
    await eraseResponsesDsarTx(tx, abandoned, now);
    const pastEvents = await eventIdsEndedBeforeTx(tx, ago(RETENTION.attendeePiiAfterEventDays));
    return {
      files: await purgeExpiredFilesTx(tx, now),
      bulkParams:
        (await clearFinishedBulkParamsTx(tx, ago(RETENTION.bulkParamsDays))) +
        (await clearFinishedBulkParamsTx(tx, ago(RETENTION.dsarExportParamsDays), 'privacy.')),
      idempotencyKeys: await purgeExpiredIdempotencyKeysTx(tx, ago(RETENTION.idempotencyDaysAfterExpiry)),
      abandonedOrders: abandoned.length,
      holderLinks: await purgeHolderLinksTx(tx, ago(RETENTION.holderLinkDaysAfterExpiry)),
      claims: await redactStaleClaimsTx(tx, ago(RETENTION.claimDaysAfterExpiry), now),
      scans: await purgeScansBeforeTx(tx, ago(RETENTION.scanLogDays)),
      attendees: await redactAttendeesForEventsTx(tx, pastEvents, now),
      ticketHolders: await redactHoldersForEventsTx(tx, pastEvents, now),
    };
  },
  audit: (_input, r) => ({
    action: 'privacy.retention',
    targetType: 'organization',
    targetId: null,
    data: { count: r ? Object.values(r).reduce((a, b) => a + b, 0) : 0 },
  }),
});
