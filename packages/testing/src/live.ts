import { withTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { systemCtx } from './fixtures.ts';

/**
 * M3.3a e2e: a check-in device goes quiet (its last heartbeat moved `seconds` into the past), as
 * if it had stopped reporting then. The watchdog (worker, or the dev drain) notices at its next look.
 */
export async function quietDevice(orgId: string, label: string, seconds: number): Promise<number> {
  const rows = await withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ id: string }>(sql`
      update checkin.devices set last_seen_at = now() - make_interval(secs => ${seconds})
      where label = ${label} and revoked_at is null returning id`),
  );
  return rows.length;
}
