import { describe, expect, it } from 'vitest';
import {
  BACKLOG_SCANS,
  CAPACITY_NEAR_PCT,
  capacityPercent,
  deriveStaffAlerts,
  deviceOnline,
  LOW_BATTERY_PCT,
  renderStaffPush,
  STAFF_OFFLINE_AFTER_MS,
} from '../src/staff-alerts.ts';

const NOW = new Date('2027-12-01T20:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base = { eventId: 'e1', day: '2027-12-01', now: NOW, checkedIn: 0, expected: 100 };
const dev = (
  id: string,
  lastSeenAt: Date | null,
  batteryPct: number | null = 90,
  queueDepth: number | null = 0,
) => ({
  id,
  label: `Device ${id}`,
  lastSeenAt,
  batteryPct,
  queueDepth,
});

describe('staff alerts (M3.4a)', () => {
  it('online means a heartbeat within 90 s (clock skew of a minute into the future tolerated)', () => {
    expect(deviceOnline(ago(STAFF_OFFLINE_AFTER_MS), NOW)).toBe(true);
    expect(deviceOnline(ago(STAFF_OFFLINE_AFTER_MS + 1), NOW)).toBe(false);
    expect(deviceOnline(new Date(NOW.getTime() + 30_000), NOW)).toBe(true);
    expect(deviceOnline(null, NOW)).toBe(false);
  });

  it('a device offline for more than 90 s alerts once per offline spell; never-seen, put-away and future-dated do not', () => {
    const alerts = deriveStaffAlerts({
      ...base,
      devices: [
        dev('a', ago(91_000)),
        dev('b', null),
        dev('c', ago(7 * 3_600_000)),
        dev('d', new Date(NOW.getTime() + 5 * 60_000)),
      ],
    });
    expect(alerts.map((a) => a.key)).toEqual([`device_offline:a:${ago(91_000).getTime()}`]);
    expect(alerts[0]).toMatchObject({ severity: 'critical', supervisorOnly: true, deviceLabel: 'Device a' });
    // The same spell later keeps its key; a new spell after coming back gets a new one.
    const later = deriveStaffAlerts({
      ...base,
      now: new Date(NOW.getTime() + 60_000),
      devices: [dev('a', ago(91_000))],
    });
    expect(later[0]?.key).toBe(alerts[0]?.key);
  });

  it('low battery and backlog alert per hour for online devices; offline devices only say offline', () => {
    const alerts = deriveStaffAlerts({
      ...base,
      devices: [
        dev('x', ago(10_000), LOW_BATTERY_PCT, BACKLOG_SCANS),
        dev('y', ago(10_000), LOW_BATTERY_PCT + 1, BACKLOG_SCANS - 1),
        dev('z', ago(200_000), 5, 500),
      ],
    });
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      'device_backlog',
      'device_low_battery',
      'device_offline',
    ]);
    expect(alerts.find((a) => a.kind === 'device_low_battery')).toMatchObject({
      percent: LOW_BATTERY_PCT,
      key: 'device_low_battery:x:2027-12-01T20',
    });
    expect(alerts.find((a) => a.kind === 'device_backlog')?.count).toBe(BACKLOG_SCANS);
    // Critical first.
    expect(alerts[0]?.kind).toBe('device_offline');
  });

  it('capacity near at 90 % of expected, once per event day, for all staff', () => {
    expect(capacityPercent(89, 100)).toBe(89);
    expect(capacityPercent(1, 0)).toBeNull();
    expect(deriveStaffAlerts({ ...base, devices: [], checkedIn: 89 })).toEqual([]);
    const [a] = deriveStaffAlerts({ ...base, devices: [], checkedIn: CAPACITY_NEAR_PCT });
    expect(a).toMatchObject({
      kind: 'capacity_near',
      percent: 90,
      supervisorOnly: false,
      key: 'capacity_near:e1:2027-12-01',
    });
  });

  it('push text fills placeholders from the device copy, plain text only', () => {
    expect(
      renderStaffPush(
        { title: '{label} offline', body: '{percent}% · {count} · {other}' },
        { label: 'Gate', percent: 91, count: 3 },
      ),
    ).toEqual({ title: 'Gate offline', body: '91% · 3 · {other}' });
    expect(renderStaffPush({ title: 'x', body: '{label}' }, {})).toEqual({ title: 'x', body: '' });
  });
});
