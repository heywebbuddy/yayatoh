import type { TenantTx } from '@yayatoh/db';
import { actorId, type Ctx, type DomainEvent, requireOrg } from '@yayatoh/kernel';
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
}

export interface Subscriber {
  /** Stable consumer name; also the pg-boss queue suffix and the processed_events key. */
  readonly name: string;
  /** `type@version` keys, e.g. `organization.created@1`. */
  readonly events: readonly string[];
  readonly handle: (tx: TenantTx, event: PublishedEvent) => Promise<void>;
}

export function defineSubscriber(s: Subscriber): Subscriber {
  if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(s.name)) {
    throw new Error(`Subscriber name must be "module.name": ${s.name}`);
  }
  return s;
}

export const eventKey = (e: { type: string; version: number }) => `${e.type}@${e.version}`;
