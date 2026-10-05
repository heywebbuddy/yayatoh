import { listAlertsQuery } from '@yayatoh/alerts';
import { DEVICE_ONLINE_WINDOW_MS, enrollDeviceCommand, heartbeatCommand } from '@yayatoh/checkin';
import { setPlatformAuditSink } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVICE_WATCHDOG_MS, runDeviceWatchdog } from '../src/device-watchdog.ts';

/**
 * M3.3a live device watchdog (worker): orgs with a device crossing the 90 s offline line are found
 * through the SECURITY DEFINER function (platform_reader, audited), and each gets the alert
 * engine's watchdog step: "devices offline" opens the moment the device goes quiet (fake clock).
 */

let a: OrgFixture;
let eventId: string;
const audits: string[] = [];
const deps = { notifier: createNotifier() };
const hb = new Date();

beforeAll(async () => {
  setPlatformAuditSink(async ({ actor, reason }) => {
    audits.push(`${actor}|${reason}`);
  });
  ({ a } = await twoOrgs());
  eventId = (
    await executeCommand(
      createEventCommand,
      {
        name: 'Watchdog night',
        slug: `watchdog-${uuidv7().slice(-12)}`,
        timezone: 'America/Chicago',
        startsAt: new Date(hb.getTime() - 30 * 60_000).toISOString(),
        endsAt: new Date(hb.getTime() + 3 * 3_600_000).toISOString(),
      },
      a.ctx(),
      ports,
    )
  ).id;
  const d = await executeCommand(enrollDeviceCommand, { label: 'Watchdog door' }, a.ctx(), ports);
  await executeCommand(
    heartbeatCommand,
    { batteryPct: 90, queueDepth: 0, clockOffsetMs: 0, eventId },
    createCtx({ orgId: a.org.id, actor: { type: 'system', name: `device:${d.deviceId}` }, now: hb }),
    ports,
  );
}, 120_000);

afterAll(async () => {
  await closePools();
});

const offline = async (now: Date) =>
  (await executeQuery(listAlertsQuery, { eventId }, a.ctx({ now }), ports)).find(
    (x) => x.rule === 'devicesOffline',
  );

describe('live device watchdog (M3.3a)', () => {
  it('looks every second', () => {
    expect(DEVICE_WATCHDOG_MS).toBe(1_000);
  });

  it('raises "devices offline" in the second the device crosses the 90 s line, and only then', async () => {
    const tick = (ms: number) => ({
      from: new Date(hb.getTime() + ms - DEVICE_WATCHDOG_MS),
      to: new Date(hb.getTime() + ms),
    });
    // Ticks before the line find nothing for this device.
    await runDeviceWatchdog(deps, tick(60_000));
    await runDeviceWatchdog(deps, tick(89_000));
    expect(await offline(new Date(hb.getTime() + 89_000))).toBeUndefined();
    // The tick that covers the moment (90 s after the heartbeat) raises it.
    const r = await runDeviceWatchdog(deps, tick(DEVICE_ONLINE_WINDOW_MS + 500));
    expect(r.orgs).toBeGreaterThanOrEqual(1);
    expect(r.quiet).toBeGreaterThanOrEqual(1);
    const alert = await offline(new Date(hb.getTime() + DEVICE_ONLINE_WINDOW_MS + 500));
    expect(alert).toMatchObject({ state: 'open', severity: 'critical', count: 1 });
    expect((alert?.openedAt.getTime() ?? 0) - hb.getTime()).toBeLessThanOrEqual(
      DEVICE_ONLINE_WINDOW_MS + DEVICE_WATCHDOG_MS,
    );
    // Every look went through the audited platform reader, with a reason.
    expect(audits).toContain('system:device-watchdog|find orgs with devices going quiet');
    // A later tick doesn't raise it again (other test files' devices may cross meanwhile).
    await runDeviceWatchdog(deps, tick(DEVICE_ONLINE_WINDOW_MS + 5_000));
    const still = await offline(new Date(hb.getTime() + DEVICE_ONLINE_WINDOW_MS + 5_000));
    expect(still?.openedAt).toEqual(alert?.openedAt);
    expect(still?.reopenCount).toBe(0);
  });
});
