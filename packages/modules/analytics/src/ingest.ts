import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { orderMetricRefTx, refundMetricRefTx } from '@yayatoh/orders';
import {
  catchUpSubscriber,
  consumeEvent,
  defineSubscriber,
  eventKey,
  type PublishedEvent,
  type Subscriber,
  unpublishedPendingTx,
} from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ingestLog } from './schema.ts';
import { syncEventTx } from './sync.ts';
import type { AnalyticsWarehouse } from './warehouse/port.ts';
import { postgresWarehouse } from './warehouse/postgres.ts';

/** The consumer name (processed_events, pg-boss queue). */
export const WAREHOUSE_CONSUMER = 'analytics.warehouse';

const Id = z.uuid();
const OrderEvent = z.looseObject({ orderId: Id, eventId: Id.optional() });
const EventScoped = z.looseObject({ eventId: Id });

/**
 * The domain events the warehouse ingests, each with the payload schema of that exact version
 * (M6.2a). A new version of an event is a new key here: until it is added, the subscriber does
 * not receive it (subscriptions are per `type@version`), and a payload that fails its schema is
 * logged as `skipped` instead of guessed at. Only ids are read from payloads; every figure comes
 * from the source tables.
 */
export const WAREHOUSE_EVENT_SCHEMAS = {
  'order.paid@1': OrderEvent,
  'order.refunded@1': z.looseObject({ orderId: Id, refundId: Id.optional(), eventId: Id.optional() }),
  'order.disputed@1': OrderEvent,
  'order.dispute_closed@1': OrderEvent,
  'tickets.cancelled@1': EventScoped,
  'attendee.cancelled@1': EventScoped,
  'ticket.admitted@1': EventScoped,
  'ticket.admission_undone@1': EventScoped,
  'ticket.admission_moved@1': EventScoped,
  'event.updated@1': EventScoped,
  'event.published@1': EventScoped,
  'event.postponed@1': EventScoped,
  'event.rescheduled@1': EventScoped,
  'event.cancelled@1': EventScoped,
  // M6.2b: an order's touch path was recorded (attribution rollups).
  'marketing.order_attributed@1': z.looseObject({ orderId: Id, eventId: Id }),
} as const satisfies Record<string, z.ZodType<{ eventId?: string; orderId?: string }>>;
export type WarehouseEventKey = keyof typeof WAREHOUSE_EVENT_SCHEMAS;
export const WAREHOUSE_EVENTS = Object.keys(WAREHOUSE_EVENT_SCHEMAS) as WarehouseEventKey[];

export type IngestOutcome = 'written' | 'unchanged' | 'skipped' | 'duplicate';

/** The event a source event touched: its payload names it, or its order (or refund) does. */
async function resolveEventIdTx(tx: TenantTx, key: WarehouseEventKey, payload: unknown) {
  const p = WAREHOUSE_EVENT_SCHEMAS[key].safeParse(payload ?? {});
  if (!p.success) return null;
  const d = p.data as { eventId?: string; orderId?: string; refundId?: string };
  if (d.eventId) return d.eventId;
  if (d.orderId) {
    const ref = await orderMetricRefTx(tx, d.orderId);
    if (ref) return ref.eventId;
  }
  if (d.refundId) return (await refundMetricRefTx(tx, d.refundId))?.eventId ?? null;
  return null;
}

/**
 * Ingest one domain event (inside the consumer's tenant transaction): once per source event id,
 * whatever delivers it (the relay, a replay, the dashboard's catch-up), recorded in
 * `analytics.ingest_log`. The touched event's rollups are recomputed from the sources and written
 * only if they changed (`syncEventTx`).
 */
export async function ingestEventTx(
  tx: TenantTx,
  warehouse: AnalyticsWarehouse,
  event: PublishedEvent,
): Promise<IngestOutcome> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`an:i:${event.id}`}, 0))`);
  const [seen] = await tx
    .select({ id: ingestLog.id })
    .from(ingestLog)
    .where(and(eq(ingestLog.orgId, event.orgId), eq(ingestLog.sourceEventId, event.id)));
  if (seen) return 'duplicate';
  const key = eventKey(event) as WarehouseEventKey;
  const known = key in WAREHOUSE_EVENT_SCHEMAS;
  const eventId = known ? await resolveEventIdTx(tx, key, event.payload) : null;
  let outcome: Exclude<IngestOutcome, 'duplicate'> = 'skipped';
  if (eventId) {
    const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: WAREHOUSE_CONSUMER } });
    const r = await syncEventTx({ ctx, tx }, warehouse, eventId);
    outcome = r.written ? 'written' : 'unchanged';
  }
  await tx
    .insert(ingestLog)
    .values({
      orgId: event.orgId,
      sourceEventId: event.id,
      eventType: event.type,
      eventVersion: event.version,
      eventId,
      adapter: warehouse.name,
      outcome,
    })
    .onConflictDoNothing();
  return outcome;
}

/**
 * The `analytics.warehouse` subscriber (worker): feeds the configured warehouse from the outbox.
 * Backfilled (`replayed`) history is ingested too: the warehouse is a projection, not a side effect.
 */
export function warehouseIngestor(warehouse: AnalyticsWarehouse = postgresWarehouse): Subscriber {
  return defineSubscriber({
    name: WAREHOUSE_CONSUMER,
    events: [...WAREHOUSE_EVENTS],
    acceptsReplayed: true,
    handle: async (tx, event) => {
      await ingestEventTx(tx, warehouse, event);
    },
  });
}

/** Every warehouse event of the org the ingestor has not handled (seed, tests, deploy catch-up). */
export function catchUpWarehouse(orgId: string, warehouse: AnalyticsWarehouse = postgresWarehouse) {
  return catchUpSubscriber(warehouseIngestor(warehouse), orgId);
}

/**
 * Read-your-writes for the org dashboards: ingest the org's warehouse events the relay has not
 * published yet (in production about a second of events; where no worker runs, everything new).
 * Exactly once, like the worker.
 */
export async function applyUnpublishedWarehouseEvents(
  orgId: string,
  warehouse: AnalyticsWarehouse = postgresWarehouse,
  limit = 500,
): Promise<number> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: WAREHOUSE_CONSUMER } });
  const pending = await withTenant(ctx, (tx) =>
    unpublishedPendingTx(tx, orgId, WAREHOUSE_CONSUMER, WAREHOUSE_EVENTS, limit),
  );
  if (pending.length === 0) return 0;
  const sub = warehouseIngestor(warehouse);
  let n = 0;
  for (const e of pending) if (await consumeEvent(sub, e)) n += 1;
  return n;
}
