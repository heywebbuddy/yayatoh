import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type ChatReportForReviewDto, chatReportsForReviewTx } from '@yayatoh/engagement';
import type { Staff } from './staff.ts';

/**
 * Networking chat reports across every org (M5.8b into the M1.10d review): a platform_reader read,
 * written to the access log (who, and which list) before it runs. The rows are engagement's
 * allowlisted review DTO (no names, addresses or ids beyond the report's).
 */
export function chatReports(staff: Staff, status: 'open' | 'closed'): Promise<ChatReportForReviewDto[]> {
  return withPlatformReader(
    { actor: staff.actor, reason: `staff console: networking chat reports (${status})` },
    (tx) => chatReportsForReviewTx(tx, { status }),
  );
}
