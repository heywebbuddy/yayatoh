import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import {
  type CharityForReviewDto,
  charitiesForReviewTx,
  type ExemptOrgLookup,
  exemptOrgLookupFromEnv,
} from '@yayatoh/donations';
import type { Staff } from './staff.ts';

/**
 * Charity profiles across every org for staff review (M4.8b): a platform_reader read, written to
 * the access log (who, and which list) before it runs. Rows are the donations module's
 * allowlisted review DTO.
 */
export function charitiesForReview(
  staff: Staff,
  status: 'pending' | 'reviewed',
): Promise<CharityForReviewDto[]> {
  return withPlatformReader(
    { actor: staff.actor, reason: `staff console: charity profiles (${status})` },
    (tx) => charitiesForReviewTx(tx, { status }),
  );
}

/** One org's charity profile for review (null when it has none). */
export async function charityOfOrg(staff: Staff, orgId: string): Promise<CharityForReviewDto | null> {
  const [row] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: charity profile of ${orgId}` },
    (tx) => charitiesForReviewTx(tx, { orgId, limit: 1 }),
  );
  return row ?? null;
}

/**
 * The IRS exempt-organization list: the owner-run download (`IRS_EO_BMF_DIR`) or, in dev and CI,
 * the recorded fixture. Null when neither is available (staff then cannot verify).
 */
export function irsList(): ExemptOrgLookup | null {
  return exemptOrgLookupFromEnv(process.env);
}
