import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { domainEvents, processedEvents } from '../schema.ts';
import type { PublishedEvent, Subscriber } from './outbox.ts';

/**
 * Run a subscriber for one event, exactly once per (consumer, event) even under replay:
 * the processed_events insert and the handler share one tenant transaction.
 * Returns false when the event was already handled.
 *
 * Backfilled (`replayed`) events are recorded as handled without running the handler, unless the
 * subscriber opts in (`acceptsReplayed`). The flag is read from the outbox row itself, so an
 * event handed over without it (an older queued job, a caller's own mapping) is still skipped.
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
    if (full.replayed && subscriber.acceptsReplayed !== true) return false;
    await subscriber.handle(tx, full);
    return true;
  });
}

/**
 * Which of these events each consumer has already handled (`${consumer}|${eventId}`), in one read.
 * The dev drain (e2e, batch 3g merge) re-reads an org's recent events on every call and used to
 * open one transaction per event and subscriber just to find them handled; under the full e2e
 * suite that made each drain of the shared org take 15 s or more. Callers still hand the rest to
 * `consumeEvent`, which stays the exactly-once guard.
 */
export async function processedPairsTx(
  tx: TenantTx,
  consumers: readonly string[],
  eventIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (consumers.length === 0 || eventIds.length === 0) return new Set();
  const rows = await tx
    .select({ consumer: processedEvents.consumer, eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(
      and(inArray(processedEvents.consumer, [...consumers]), inArray(processedEvents.eventId, [...eventIds])),
    );
  return new Set(rows.map((r) => `${r.consumer}|${r.eventId}`));
}

/**
 * The relay's job payload has no write time, and the replay flag is always read from the outbox
 * row itself (an event handed over without it is still treated as history).
 */
async function withEventMetaTx(tx: TenantTx, event: PublishedEvent): Promise<PublishedEvent> {
  const [row] = await tx
    .select({ createdAt: domainEvents.createdAt, replayed: domainEvents.replayed })
    .from(domainEvents)
    .where(eq(domainEvents.id, event.id));
  return {
    ...event,
    occurredAt: event.occurredAt ?? row?.createdAt.toISOString() ?? new Date().toISOString(),
    replayed: event.replayed === true || row?.replayed === true,
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
