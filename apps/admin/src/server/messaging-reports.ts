import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type ReportForReviewDto, reportsForReviewTx } from '@yayatoh/messaging';
import type { Staff } from './staff.ts';

/**
 * Messaging reports across every org (M1.10d) for staff review: a platform_reader read, so it is
 * written to the access log (who, and which list) before it runs. The rows are the messaging
 * module's allowlisted review DTO (no contact addresses, staff names or internal ids).
 */
export function messagingReports(staff: Staff, status: 'open' | 'closed'): Promise<ReportForReviewDto[]> {
  return withPlatformReader(
    { actor: staff.actor, reason: `staff console: messaging reports (${status})` },
    (tx) => reportsForReviewTx(tx, { status }),
  );
}
