import 'server-only';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type ProviderHealthDto, providerHealthTx } from '@yayatoh/notifications';
import type { Staff } from './staff.ts';

/**
 * Messaging provider health (M3.5b): counters per provider over 24 hours, the last webhook, and
 * each real provider's switch-on checklist. A platform_reader read, access-logged first; config
 * is checked by name only (values never leave the environment).
 */
export function providerHealth(staff: Staff): Promise<ProviderHealthDto[]> {
  return withPlatformReader(
    { actor: staff.actor, reason: 'staff console: messaging provider health' },
    (tx) => providerHealthTx(tx, process.env),
  );
}
