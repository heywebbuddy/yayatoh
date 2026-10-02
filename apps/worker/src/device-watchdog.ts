import { type AlertDeps, watchQuietDevices } from '@yayatoh/alerts';
import { DEVICE_ONLINE_WINDOW_MS } from '@yayatoh/checkin';
import { withPlatformReader } from '@yayatoh/db/platform';
import { sql } from 'drizzle-orm';

/** How often the watchdog looks (M3.3a): a device is reported within a second of going offline. */
export const DEVICE_WATCHDOG_MS = 1_000;

/**
 * The live device watchdog (M3.3a). Every second it asks which orgs have a device whose offline
 * moment (last heartbeat + the 90 s window) fell since the previous look, through a SECURITY
 * DEFINER function (org ids only), and runs the alert engine's watchdog step for each: the device
 * gets its "offline" transition and the "devices offline" alert is raised at once. One org's
 * failure never stops the others.
 */
export async function runDeviceWatchdog(
  deps: AlertDeps,
  window: { from: Date; to: Date },
): Promise<{ orgs: number; quiet: number; changes: number }> {
  const orgs = await withPlatformReader(
    { actor: 'system:device-watchdog', reason: 'find orgs with devices going quiet' },
    (tx) =>
      tx.execute<{ org_id: string }>(
        sql`select org_id from checkin.orgs_with_devices_going_quiet(${window.from.toISOString()}::timestamptz, ${window.to.toISOString()}::timestamptz, ${DEVICE_ONLINE_WINDOW_MS})`,
      ),
  );
  let quiet = 0;
  let changes = 0;
  for (const { org_id } of orgs) {
    try {
      const r = await watchQuietDevices(org_id, deps, { now: window.to });
      quiet += r.quiet;
      changes += r.changes.length;
    } catch (err) {
      console.error('device watchdog', org_id, err);
    }
  }
  return { orgs: orgs.length, quiet, changes };
}
