import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';

/**
 * Switch agency v2 (M6.8b: publishing downward, campaign fan-out, handover, team and day-of
 * grants) on or off for the platform as staff: this CLI, tests and runbooks. Goes through
 * `platform.set_flag`, which records the change with its reason; audited through the
 * platform-reader sink. True when the switch changed.
 */
export async function setAgencyV2(opts: { enabled: boolean; by: string; reason: string }): Promise<boolean> {
  const [row] = await withPlatformReader(
    { actor: opts.by, reason: `${opts.enabled ? 'enable' : 'disable'} agency v2: ${opts.reason}` },
    (tx) =>
      tx.execute<{ changed: boolean }>(
        sql`select platform.set_flag('agency_v2', ${opts.enabled}, ${opts.by}, ${opts.reason}) as changed`,
      ),
    { callsWritingFunctions: true },
  );
  return row?.changed === true;
}
