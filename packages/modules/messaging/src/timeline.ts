import { contactIdByEmailTx, recordTimelineTx } from '@yayatoh/crm';
import { createCtx } from '@yayatoh/kernel';
import { defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { threadMessages, threads } from './schema.ts';

const Ref = z.object({ threadId: z.uuid(), messageId: z.uuid() });

/**
 * The person timeline's messages (M6.1a): what the person wrote to the organizer and the
 * organizer's replies, on the contact with the thread's address (a merged-away address lands on
 * the record it was merged into). Never the message text: the timeline links to the thread.
 */
export function messagingTimeline(): Subscriber {
  return defineSubscriber({
    name: 'messaging.timeline',
    events: ['thread.contact_wrote@1', 'thread.replied@1'],
    handle: async (tx, event) => {
      const p = Ref.parse(event.payload);
      const [row] = await tx
        .select({
          email: threads.contactEmail,
          at: threadMessages.createdAt,
          eventId: threadMessages.eventId,
        })
        .from(threadMessages)
        .innerJoin(threads, eq(threads.id, threadMessages.threadId))
        .where(eq(threadMessages.id, p.messageId));
      if (!row) return;
      const contactId = await contactIdByEmailTx(tx, row.email);
      if (!contactId) return;
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'messaging.timeline' } });
      await recordTimelineTx(tx, ctx, [
        {
          contactId,
          kind: event.type === 'thread.contact_wrote' ? 'message_in' : 'message_out',
          occurredAt: row.at,
          eventId: row.eventId,
          sourceRef: p.messageId,
        },
      ]);
    },
  });
}
