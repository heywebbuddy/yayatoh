import type { TenantTx } from '@yayatoh/db';
import { defineRealtimeChannel, publishRealtimeTx } from '@yayatoh/platform';
import { z } from 'zod';

/**
 * The guest list of one event, live (M4.3a): which party changed (ids only; the seating editor
 * and the guests page re-read). Published in the same transaction as the change by the history
 * writers, so every change that writes `rsvp_history` (a guest or plus-one added, named, moved
 * or removed, a meal, an RSVP answer, an import) reaches the editor's unseated queue, and a
 * rolled-back change never does.
 */
export const GUESTS_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'guests',
  source: 'log',
  description: 'Guest list changes of one event (party ids only; the console re-reads)',
  entitlement: 'guests',
  access: { permission: 'guests:read' },
  events: {
    party: z.object({ partyId: z.uuid(), at: z.iso.datetime({ offset: true }) }),
    /** Many parties at once (an import, an "everyone invited" switch): re-read the whole list. */
    list: z.object({ at: z.iso.datetime({ offset: true }) }),
  },
});

/** Party messages per transaction and event before one `list` message stands in for the rest. */
export const MAX_PARTY_MESSAGES = 20;

type Published = Map<string, Set<string> | 'list'>;
const publishedIn = new WeakMap<object, Published>();

/**
 * Tell the event's guest channel which parties changed in this transaction (`null` = not one
 * party: the whole list). Each party once per transaction; past `MAX_PARTY_MESSAGES`, one `list`
 * message and nothing more for that event.
 */
export async function publishGuestChangesTx(
  tx: TenantTx,
  orgId: string,
  changes: readonly { readonly eventId: string; readonly partyId: string | null }[],
  now: Date,
) {
  const seen: Published = publishedIn.get(tx) ?? new Map();
  publishedIn.set(tx, seen);
  const at = now.toISOString();
  for (const c of changes) {
    const done = seen.get(c.eventId) ?? new Set<string>();
    if (done === 'list') continue;
    if (c.partyId && done.has(c.partyId)) continue;
    if (!c.partyId || done.size >= MAX_PARTY_MESSAGES) {
      seen.set(c.eventId, 'list');
      await publishRealtimeTx(tx, orgId, GUESTS_CHANNEL, { eventId: c.eventId, event: 'list', data: { at } });
      continue;
    }
    done.add(c.partyId);
    seen.set(c.eventId, done);
    await publishRealtimeTx(tx, orgId, GUESTS_CHANNEL, {
      eventId: c.eventId,
      event: 'party',
      data: { partyId: c.partyId, at },
    });
  }
}
