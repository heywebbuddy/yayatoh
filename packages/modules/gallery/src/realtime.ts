import type { TenantTx } from '@yayatoh/db';
import { defineRealtimeChannel, publishRealtimeTx } from '@yayatoh/platform';
import { z } from 'zod';

/**
 * The live slideshow's feed (M4.5b): ids and states only, so the message log never holds a file
 * URL or a name; the slideshow re-reads the published photos (allowlisted, signed URLs) when one
 * arrives. Members with `guests:read` attach through the realtime route; guests past the site
 * password through the gallery's own stream route, which checks the password first.
 */
export const GALLERY_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'gallery',
  source: 'log',
  description: 'Gallery items of one event as they are published or removed (ids; the slideshow re-reads)',
  entitlement: 'gallery',
  access: { permission: 'guests:read' },
  events: {
    item: z.object({
      itemId: z.uuid(),
      state: z.enum(['published', 'removed']),
      at: z.iso.datetime({ offset: true }),
    }),
  },
});

export async function publishItemTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  itemId: string,
  state: 'published' | 'removed',
  at: Date,
): Promise<void> {
  await publishRealtimeTx(tx, orgId, GALLERY_CHANNEL, {
    eventId,
    event: 'item',
    data: { itemId, state, at: at.toISOString() },
  });
}
