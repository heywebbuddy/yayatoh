import type { TenantTx } from '@yayatoh/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { checkpointsTx } from './checkpoints.ts';
import { devices, staffAlertPushes, staffPushSubscriptions } from './schema.ts';

/**
 * Narrow reads and one write for M3.3b guest assistance (tier 5), which shows where a staff
 * request came from and pushes urgent requests to the staff devices at the event.
 */

/** Device labels by id (revoked devices included: a request keeps saying which phone raised it). */
export async function deviceLabelsTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: devices.id, label: devices.label })
    .from(devices)
    .where(inArray(devices.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.label]));
}

/** An event's checkpoint names by id (archived ones included, for older requests). */
export async function checkpointNamesTx(tx: TenantTx, eventId: string): Promise<Map<string, string>> {
  return new Map((await checkpointsTx(tx, eventId, true)).map((c) => [c.id, c.name]));
}

/**
 * Queue one push (kind `assistance`) for every staff device subscribed at the event, except the
 * one that raised it. `alertKey` makes it once per device (a replayed command queues nothing).
 * The staff push sender (worker loop, dev drain) sends it in the device's own words.
 */
export async function queueStaffPushTx(
  tx: TenantTx,
  opts: {
    readonly orgId: string;
    readonly eventId: string;
    readonly alertKey: string;
    readonly label: string;
    readonly exceptDeviceId?: string | null;
  },
): Promise<number> {
  const subs = await tx
    .select({ id: staffPushSubscriptions.id, deviceId: staffPushSubscriptions.deviceId })
    .from(staffPushSubscriptions)
    .innerJoin(
      devices,
      and(eq(devices.orgId, staffPushSubscriptions.orgId), eq(devices.id, staffPushSubscriptions.deviceId)),
    )
    .where(
      and(
        eq(devices.eventId, opts.eventId),
        isNull(devices.revokedAt),
        isNull(staffPushSubscriptions.disabledAt),
      ),
    );
  let queued = 0;
  for (const s of subs) {
    if (s.deviceId === opts.exceptDeviceId) continue;
    const rows = await tx
      .insert(staffAlertPushes)
      .values({
        orgId: opts.orgId,
        subscriptionId: s.id,
        eventId: opts.eventId,
        alertKey: opts.alertKey,
        kind: 'assistance',
        params: { label: opts.label.slice(0, 120) },
      })
      .onConflictDoNothing()
      .returning({ id: staffAlertPushes.id });
    queued += rows.length;
  }
  return queued;
}
