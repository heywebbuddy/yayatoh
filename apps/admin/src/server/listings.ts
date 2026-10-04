import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type ModerationItemDto, type ModerationState, moderationQueueTx } from '@yayatoh/marketplace';
import type { Staff } from './staff.ts';

/**
 * The marketplace listing moderation queue across every org (M6.14a): a platform_reader read,
 * written to the access log (who, which list) before it runs. Rows are marketplace's allowlisted
 * queue DTO (public listing fields, the org, the staff reason).
 */
export function listingQueue(staff: Staff, state: ModerationState, q?: string): Promise<ModerationItemDto[]> {
  return withPlatformReader(
    { actor: staff.actor, reason: `staff console: marketplace listings (${state})` },
    (tx) => moderationQueueTx(tx, { state, ...(q ? { q } : {}) }),
  );
}
