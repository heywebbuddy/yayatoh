import { THRESHOLDS } from '@yayatoh/alerts';
import {
  BACKLOG_SCANS,
  DEVICE_ONLINE_WINDOW_MS,
  LOW_BATTERY_PCT,
  STAFF_OFFLINE_AFTER_MS,
} from '@yayatoh/checkin';
import { CAPACITY_NEAR_PCT, CAPACITY_OVER_PCT } from '@yayatoh/command-center';
import { describe, expect, it } from 'vitest';

/**
 * Batch 3d merge: the Scan PWA's staff alerts (M3.4a) and the Command Center's alert engine
 * (M3.2b) judge the same devices, so they use the same numbers. A change to one must change both.
 */
describe('device alert thresholds', () => {
  it('match between staff mode and the alert engine', () => {
    expect(LOW_BATTERY_PCT).toBe(THRESHOLDS.lowBatteryPct);
    expect(BACKLOG_SCANS).toBe(THRESHOLDS.backlogScans);
  });

  it('call a device offline after the same silence', () => {
    // The alert engine counts offline devices with the device board's online window.
    expect(STAFF_OFFLINE_AFTER_MS).toBe(DEVICE_ONLINE_WINDOW_MS);
  });

  it('grade capacity the same on the live gauges and in the capacity alerts (M3.3a)', () => {
    expect(CAPACITY_NEAR_PCT).toBe(THRESHOLDS.capacityNearPct);
    expect(CAPACITY_OVER_PCT).toBe(THRESHOLDS.capacityFullPct);
  });
});
