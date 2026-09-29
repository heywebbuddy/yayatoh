import { DEVICE_ONLINE_WINDOW_MS, listDevicesQuery } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { EventDto, listEventsQuery } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import {
  DEVICES_CHANNEL,
  defineSubscriber,
  METRICS_CHANNEL,
  publishRealtimeTx,
  type Subscriber,
} from '@yayatoh/platform';
import { z } from 'zod';
import { eventModeTx } from './view.ts';

/**
 * Live updates for the Command Center's widgets (M3.2 on the M3.1b channels).
 *
 * `event.metrics` carries a value-free "changed" ping, never a number: the channel admits anyone
 * who can read the event (door staff included), so a revenue figure on it would reach the door.
 * The widget re-reads through its own loader, which applies the role rules.
 */
export async function publishMetricsChangedTx(tx: TenantTx, orgId: string, eventId: string, at: Date) {
  await publishRealtimeTx(tx, orgId, METRICS_CHANNEL, {
    eventId,
    event: 'metric',
    data: { metric: 'changed', value: 0, at: at.toISOString() },
  });
}

export const DEVICE_BOARD_EVENTS = ['device.enrolled@1', 'device.state_changed@1', 'device.heartbeat@1'] as const;

const DevicePayload = z.object({ deviceId: z.uuid() });
/** Events whose span is this close to now can be in pre-show or live (checked exactly after). */
const NEAR_MS = 3 * 24 * 3_600_000;

/**
 * Device presence for the device widgets (`event.devices`): a check-in device's enrolment, state
 * change or heartbeat is published to every event of its org that is in pre-show or live now
 * (devices belong to the org, not to one event). Ids, state, battery and queue depth only.
 */
export function deviceBoardPublisher(): Subscriber {
  return defineSubscriber({
    name: 'command-center.devices',
    events: DEVICE_BOARD_EVENTS,
    handle: async (tx, event) => {
      const parsed = DevicePayload.safeParse(event.payload);
      if (!parsed.success) return;
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'command-center.devices' } });
      const device = (await listDevicesQuery.handler({ input: {}, ctx, tx })).find(
        (d) => d.id === parsed.data.deviceId,
      );
      if (!device) return;
      const now = ctx.now.getTime();
      const state = device.revoked
        ? 'revoked'
        : device.wipeRequested
          ? 'wiped'
          : device.lastSeenAt && now - device.lastSeenAt.getTime() <= DEVICE_ONLINE_WINDOW_MS
            ? 'online'
            : 'offline';
      const near = (await listEventsQuery.handler({ input: {}, ctx, tx })).map((e) => EventDto.parse(e)).filter(
        (e) =>
          !['cancelled', 'archived'].includes(e.status) &&
          e.startsAt.getTime() - NEAR_MS <= now &&
          e.endsAt.getTime() + NEAR_MS >= now,
      );
      for (const ev of near) {
        const mode = await eventModeTx(tx, ctx, ev);
        if (mode.mode !== 'pre_show' && mode.mode !== 'live') continue;
        await publishRealtimeTx(tx, event.orgId, DEVICES_CHANNEL, {
          eventId: ev.id,
          event: 'device',
          data: {
            deviceId: device.id,
            state,
            batteryPct: device.batteryPct,
            queueDepth: device.queueDepth,
            at: ctx.now.toISOString(),
          },
        });
      }
    },
  });
}
