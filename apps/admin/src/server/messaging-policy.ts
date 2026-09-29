import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type AutoPausedOrgDto, autoPausedOrgsTx } from '@yayatoh/notifications';
import type { Staff } from './staff.ts';

/**
 * Orgs whose messaging paused itself for a complaint rate over 0.3 % (M3.5a): a platform_reader
 * read, written to the access log before it runs. This list (and its count in the header) is how
 * staff hear about an auto-pause until the alert engine routes it (M3.2b).
 */
export function autoPausedOrgs(staff: Staff): Promise<AutoPausedOrgDto[]> {
  return withPlatformReader({ actor: staff.actor, reason: 'staff console: auto-paused messaging' }, (tx) =>
    autoPausedOrgsTx(tx),
  );
}
