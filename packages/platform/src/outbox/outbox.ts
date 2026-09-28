import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { and, asc, gt, inArray } from 'drizzle-orm';
import { domainEvents } from '../schema.ts';

/** Write events to the outbox inside the caller's tenant transaction (step 8). */
export async function emitEvents(tx: TenantTx, ctx: Ctx, events: readonly DomainEvent[]): Promise<void> {
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
  /** Backfilled history (legacy migration T9): skipped unless the subscriber opts in. */
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
    replayed: r.replayed,
  }));
}
