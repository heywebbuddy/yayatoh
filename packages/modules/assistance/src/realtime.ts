import type { TenantTx } from '@yayatoh/db';
import { defineRealtimeChannel, publishRealtimeTx } from '@yayatoh/platform';
import { z } from 'zod';
import { PRIORITIES, REQUEST_STATES } from './domain/rules.ts';

/**
 * The event's help queue, live (M3.3b): one message per new or changed request, ids and states
 * only (never who asked or what they wrote); the console and the Scan PWA re-read the queue.
 * Members who may read the queue and the org's check-in devices may attach.
 */
export const ASSISTANCE_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'assistance',
  source: 'log',
  description: 'Help requests of one event (ids and states; the queue re-reads the rest)',
  entitlement: 'checkin',
  access: { permission: 'assistance:read', devices: true },
  events: {
    request: z.object({
      requestId: z.uuid(),
      state: z.enum(REQUEST_STATES),
      priority: z.enum(PRIORITIES),
      at: z.iso.datetime({ offset: true }),
    }),
  },
});

export async function publishRequestTx(
  tx: TenantTx,
  orgId: string,
  row: { id: string; eventId: string; state: string; priority: string },
  at: Date,
) {
  await publishRealtimeTx(tx, orgId, ASSISTANCE_CHANNEL, {
    eventId: row.eventId,
    event: 'request',
    data: { requestId: row.id, state: row.state, priority: row.priority, at: at.toISOString() },
  });
}
