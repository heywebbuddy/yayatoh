import { defineSerializer } from '@yayatoh/contracts';
import { TIMELINE_KINDS, timelineEventIdsTx, timelinePageTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';

const Kind = z.enum(TIMELINE_KINDS);

export const PersonTimelineDto = z.object({
  rows: z.array(
    z.object({
      id: z.uuid(),
      kind: Kind,
      occurredAt: z.date(),
      eventId: z.uuid().nullable(),
      eventName: z.string().nullable(),
      amountMinor: z.int().nullable(),
      currency: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
  next: z.object({ at: z.date(), id: z.uuid() }).nullable(),
  /** The events this person's timeline mentions (the event filter), most recent first. */
  events: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type PersonTimelineDto = z.infer<typeof PersonTimelineDto>;
export const personTimelineSerializer = defineSerializer('audiences.personTimeline', PersonTimelineDto);

async function eventNamesTx(tx: TenantTx, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of new Set(ids)) {
    const e = await findEventTx(tx, id);
    if (e) out.set(id, e.name);
  }
  return out;
}

/**
 * The person timeline (M6.1a): one chronological feed, newest first, from the crm projection
 * only (orders, refunds, check-ins, campaign sends, messages, surveys…), filtered by kind and
 * event, keyset paged. Event names come from the events module (a lookup, not a join).
 */
export const personTimelineQuery = tenantQuery({
  name: 'audiences.personTimeline',
  input: z.object({
    contactId: z.uuid(),
    kinds: z.array(Kind).max(TIMELINE_KINDS.length).optional(),
    eventId: z.uuid().optional(),
    before: z.object({ at: z.coerce.date(), id: z.uuid() }).optional(),
    limit: z.int().min(1).max(100).default(25),
  }),
  output: PersonTimelineDto,
  entitlement: 'marketing',
  permission: 'contacts:read',
  handler: async ({ input, tx }) => {
    const page = await timelinePageTx(tx, input);
    const eventIds = (await timelineEventIdsTx(tx, input.contactId)).slice(0, 100);
    const names = await eventNamesTx(tx, [
      ...eventIds,
      ...page.rows.flatMap((r) => (r.eventId ? [r.eventId] : [])),
    ]);
    return personTimelineSerializer.serialize({
      rows: page.rows.map((r) => ({ ...r, eventName: r.eventId ? (names.get(r.eventId) ?? null) : null })),
      next: page.next,
      events: eventIds.flatMap((id) => {
        const name = names.get(id);
        return name ? [{ id, name }] : [];
      }),
    });
  },
});
