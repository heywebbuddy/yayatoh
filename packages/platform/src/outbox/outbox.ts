import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { and, asc, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { domainEvents, processedEvents } from '../schema.ts';

/**
 * Write events to the outbox inside the caller's tenant transaction (step 8). `replayed` marks
 * backfilled history (the legacy migration): projections apply it, side effects never fire.
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
  /** Backfilled history (see emitEvents). Filled in by consumeEvent when absent. */
  readonly replayed?: boolean;
}

export interface Subscriber {
  /** Stable consumer name; also the pg-boss queue suffix and the processed_events key. */
  readonly name: string;
  /** `type@version` keys, e.g. `organization.created@1`. */
  readonly events: readonly string[];
  readonly handle: (tx: TenantTx, event: PublishedEvent) => Promise<void>;
  /**
   * What to do with backfilled (`replayed`) events. Default `skip`: they are marked handled and
   * never reach `handle`, so mail, journeys and webhooks never fire for history. Projections
   * (metrics, listings, the analytics sink) pass `apply`.
   */
  readonly replay?: 'apply' | 'skip';
}

export function defineSubscriber(s: Subscriber): Subscriber {
  if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(s.name)) {
    throw new Error(`Subscriber name must be "module.name": ${s.name}`);
  }
  return s;
}

export const eventKey = (e: { type: string; version: number }) => `${e.type}@${e.version}`;

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
    .orderBy(asc(domainEvents.createdAt), asc(domainEvents.id))
    .limit(500);
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
