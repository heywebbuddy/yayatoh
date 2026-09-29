import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';

/**
 * Open or close self-serve signup (M3.11a) as platform staff: this CLI, tests and runbooks; the
 * staff console has its own screen. Goes through `platform.set_flag`, which records the change
 * with its reason; audited through the platform-reader sink. True when the switch changed.
 */
export async function setOpenSignup(opts: {
  enabled: boolean;
  by: string;
  reason: string;
}): Promise<boolean> {
  const [row] = await withPlatformReader(
    { actor: opts.by, reason: `${opts.enabled ? 'open' : 'close'} self-serve signup: ${opts.reason}` },
    (tx) =>
      tx.execute<{ changed: boolean }>(
        sql`select platform.set_flag('open_signup', ${opts.enabled}, ${opts.by}, ${opts.reason}) as changed`,
      ),
    { callsWritingFunctions: true },
  );
  return row?.changed === true;
}
