import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { deviceIdOf } from './device-actor.ts';
import { devices } from './schema.ts';

/**
 * M5.5c: the calling device, which must be a live kiosk locked to this event. Kiosk self-print
 * commands run as the device (its bearer token); anything else (a member, another device, a
 * kiosk of another event) is refused.
 */
export async function requireKioskDeviceTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
): Promise<{ deviceId: string; checkpointId: string | null; startedAt: Date }> {
  const deviceId = deviceIdOf(ctx);
  const [d] = await tx
    .select({
      mode: devices.mode,
      eventId: devices.kioskEventId,
      checkpointId: devices.kioskCheckpointId,
      startedAt: devices.kioskStartedAt,
    })
    .from(devices)
    .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)));
  if (d?.mode !== 'kiosk' || d.eventId !== eventId || !d.startedAt)
    throw new DomainError('forbidden', 'Not a kiosk at this event', { reason: 'not_kiosk' });
  return { deviceId, checkpointId: d.checkpointId, startedAt: d.startedAt };
}
