import { derivedStaffAlerts, type StaffAlert, type StaffAlertSource } from '@yayatoh/checkin';
import { and, eq, inArray } from 'drizzle-orm';
import type { RuleKey } from './domain/config.ts';
import { alerts } from './schema.ts';

/** The alert engine's rule behind each Scan PWA staff alert kind. */
const RULE_OF: Readonly<Record<StaffAlert['kind'], RuleKey>> = {
  device_offline: 'devicesOffline',
  device_low_battery: 'devicesLowBattery',
  device_backlog: 'devicesBacklog',
  capacity_near: 'capacityNear',
};

/**
 * The alert engine (M3.2b) behind the Scan PWA's staff alerts (M3.4a): staff keep the per-device
 * detail the derivation gives (which device, its battery, its queue) on the engine's thresholds,
 * and an alert the organizer acknowledged or snoozed in the Command Center is quiet on the staff
 * devices too, until it reopens. The derivation alone (`derivedStaffAlerts`) stays for tests.
 */
export function engineStaffAlerts(base: StaffAlertSource = derivedStaffAlerts): StaffAlertSource {
  return {
    async list(tx, input) {
      const derived = await base.list(tx, input);
      if (derived.length === 0) return derived;
      const rules = [...new Set(derived.map((a) => RULE_OF[a.kind]))];
      const rows = await tx
        .select({ rule: alerts.rule, state: alerts.state, snoozedUntil: alerts.snoozedUntil })
        .from(alerts)
        .where(and(eq(alerts.eventId, input.eventId), inArray(alerts.rule, rules)));
      const quiet = new Set(
        rows
          .filter(
            (r) =>
              r.state === 'acknowledged' ||
              (r.state === 'snoozed' && r.snoozedUntil !== null && r.snoozedUntil > input.now),
          )
          .map((r) => r.rule),
      );
      return derived.filter((a) => !quiet.has(RULE_OF[a.kind]));
    },
  };
}
