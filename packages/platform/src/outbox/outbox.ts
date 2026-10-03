import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { and, asc, desc, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { domainEvents, processedEvents } from '../schema.ts';

/**
 * Write events to the outbox inside the caller's tenant transaction (step 8). `replayed` marks
 * backfilled history (the legacy migration): projections that opt in apply it, side effects never fire.
 */
export async function emitEvents(
  tx: TenantTx,
  ctx: Ctx,
  events: readonly DomainEvent[],
  opts: { replayed?: boolean } = {},
): Promise<void> {
  if (events.length === 0) return;
  const orgId = requireOrg(ctx);
  await tx.insert(domainEvents).values(
    events.map((e) => ({
      orgId,
      type: e.type,
      version: e.version,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      payload: e.payload as object,
      actor: actorId(ctx.actor),
      requestId: ctx.requestId,
      replayed: opts.replayed === true,
    })),
  );
}

/** What a subscriber receives: an outbox event after the relay stamped it. */
export interface PublishedEvent {
  readonly id: string;
  readonly orgId: string;
  readonly type: string;
  readonly version: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly logSeq: number;
  /** When the event was written (ISO; the source transaction's time). Filled in by consumeEvent when absent. */
  readonly occurredAt?: string;
  /** Backfilled history (legacy migration T9): skipped unless the subscriber opts in. Filled in by consumeEvent when absent. */
  readonly replayed?: boolean;
}

export interface Subscriber {
  /** Stable consumer name; also the pg-boss queue suffix and the processed_events key. */
  readonly name: string;
  /** `type@version` keys, e.g. `organization.created@1`. */
  readonly events: readonly string[];
  readonly handle: (tx: TenantTx, event: PublishedEvent) => Promise<void>;
  /**
   * Projectors that rebuild history from the log opt in to `replayed` events. Everything else
   * (mailers, notifications, journeys, automations) never sees them (ADR 0008).
   */
  readonly acceptsReplayed?: boolean;
}

export function defineSubscriber(s: Subscriber): Subscriber {
  if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(s.name)) {
    throw new Error(`Subscriber name must be "module.name": ${s.name}`);
  }
  return s;
}

export const eventKey = (e: { type: string; version: number }) => `${e.type}@${e.version}`;

/** Does this subscriber take this event (its type and version, and replayed history only if it opts in)? */
export const subscribes = (s: Subscriber, e: PublishedEvent) =>
  s.events.includes(eventKey(e)) && (!e.replayed || s.acceptsReplayed === true);

/**
 * Which (consumer, event) pairs of these events were already handled (`processed_events`), as
 * `"{consumer} {eventId}"` keys, in one query. Dev tooling (the web app's dev drain) skips them
 * instead of opening a transaction per pair: `consumeEvent` stays the guard for the rest.
 */
export async function processedPairsTx(tx: TenantTx, eventIds: readonly string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await tx
    .select({ consumer: processedEvents.consumer, eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(inArray(processedEvents.eventId, [...eventIds]));
  return new Set(rows.map((r) => `${r.consumer} ${r.eventId}`));
}

/**
 * This org's recent outbox events of the given types (dev tooling: the web app's dev drain
 * replays them through subscribers; consumers dedupe, so replays are harmless).
 */
export async function recentEventsTx(
  tx: TenantTx,
  orgId: string,
  types: readonly string[],
  sinceMs: number,
): Promise<PublishedEvent[]> {
  if (types.length === 0) return [];
  const rows = await tx
    .select()
    .from(domainEvents)
    .where(
      and(inArray(domainEvents.type, [...types]), gt(domainEvents.createdAt, new Date(Date.now() - sinceMs))),
    )
    // The newest 500, handed over oldest first (a busy org's latest events are never cut off).
    .orderBy(desc(domainEvents.createdAt), desc(domainEvents.id))
    .limit(500);
  rows.reverse();
  return rows.map((r) => ({
    id: r.id,
    orgId,
    type: r.type,
    version: r.version,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    payload: r.payload,
    logSeq: r.logSeq ?? 0,
    occurredAt: r.createdAt.toISOString(),
    replayed: r.replayed,
  }));
}

/**
 * This org's events of the given `type@version` keys that are not yet published by the relay
 * and that `consumer` has not handled, oldest first (read-your-writes for projections: a page can
 * apply what the relay has not picked up yet; in production that is at most a second of events).
 * Uses the partial index on unpublished events.
 */
export async function unpublishedPendingTx(
  tx: TenantTx,
  orgId: string,
  consumer: string,
  keys: readonly string[],
  limit = 500,
): Promise<PublishedEvent[]> {
  if (keys.length === 0) return [];
  const rows = await tx
    .select()
    .from(domainEvents)
    .where(
      and(
        isNull(domainEvents.publishedAt),
        inArray(sql`${domainEvents.type} || '@' || ${domainEvents.version}`, [...keys]),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(processedEvents)
            .where(and(eq(processedEvents.consumer, consumer), eq(processedEvents.eventId, domainEvents.id))),
        ),
      ),
    )
    .orderBy(asc(domainEvents.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    orgId,
    type: r.type,
    version: r.version,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    payload: r.payload,
    logSeq: r.logSeq ?? 0,
    occurredAt: r.createdAt.toISOString(),
    replayed: r.replayed,
  }));
}
