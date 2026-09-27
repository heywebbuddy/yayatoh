import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { processedEvents } from '../schema.ts';
import type { PublishedEvent, Subscriber } from './outbox.ts';

/**
 * Run a subscriber for one event, exactly once per (consumer, event) even under replay:
 * the processed_events insert and the handler share one tenant transaction.
 * Returns false when the event was already handled.
 */
export async function consumeEvent(subscriber: Subscriber, event: PublishedEvent): Promise<boolean> {
  const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: subscriber.name } });
  return withTenant(ctx, async (tx: TenantTx) => {
    const inserted = await tx
      .insert(processedEvents)
      .values({ orgId: event.orgId, consumer: subscriber.name, eventId: event.id })
      .onConflictDoNothing()
      .returning({ id: processedEvents.id });
    if (inserted.length === 0) return false;
    await subscriber.handle(tx, event);
    return true;
  });
}
