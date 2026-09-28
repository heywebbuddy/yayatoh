import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { domainEvents, processedEvents } from '../schema.ts';
import type { PublishedEvent, Subscriber } from './outbox.ts';

/**
 * Run a subscriber for one event, exactly once per (consumer, event) even under replay:
 * the processed_events insert and the handler share one tenant transaction.
 * Returns false when the event was already handled, or when it is backfilled history
 * (`replayed`) and the subscriber does not apply history (it is still marked handled).
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
    const full = await withEventMetaTx(tx, event);
    if (full.replayed && subscriber.replay !== 'apply') return false;
    await subscriber.handle(tx, full);
    return true;
  });
}

/** The relay's job payload has no write time or replay flag: read them from the outbox row. */
async function withEventMetaTx(tx: TenantTx, event: PublishedEvent): Promise<PublishedEvent> {
  if (event.occurredAt !== undefined && event.replayed !== undefined) return event;
  const [row] = await tx
    .select({ createdAt: domainEvents.createdAt, replayed: domainEvents.replayed })
    .from(domainEvents)
    .where(eq(domainEvents.id, event.id));
  return {
    ...event,
    occurredAt: event.occurredAt ?? row?.createdAt.toISOString() ?? new Date().toISOString(),
    replayed: event.replayed ?? row?.replayed ?? false,
  };
}

/**
 * Hand one org's committed events that a subscriber has not handled yet to it, oldest first
 * (seed scripts and e2e, where no worker runs; a projector's catch-up after a deploy). Each event
 * still goes through consumeEvent, so a concurrent worker never double-applies one.
 */
export async function catchUpSubscriber(subscriber: Subscriber, orgId: string): Promise<number> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: subscriber.name } });
  const pending = await withTenant(ctx, (tx) =>
    tx
      .select()
      .from(domainEvents)
      .where(
        and(
          inArray(sql`${domainEvents.type} || '@' || ${domainEvents.version}`, [...subscriber.events]),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(processedEvents)
              .where(
                and(
                  eq(processedEvents.consumer, subscriber.name),
                  eq(processedEvents.eventId, domainEvents.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(domainEvents.id)),
  );
  let n = 0;
  for (const e of pending) {
    const done = await consumeEvent(subscriber, {
      id: e.id,
      orgId: e.orgId,
      type: e.type,
      version: e.version,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      payload: e.payload,
      logSeq: e.logSeq ?? 0,
      occurredAt: e.createdAt.toISOString(),
      replayed: e.replayed,
    });
    if (done) n += 1;
  }
  return n;
}
