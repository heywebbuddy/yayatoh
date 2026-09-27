import { withPlatformReader } from '@yayatoh/db/platform';
import { eventKey, type PublishedEvent, type Subscriber } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

export const subscriberQueue = (s: Subscriber) => `sub.${s.name}`;

type Row = {
  id: string;
  org_id: string;
  type: string;
  version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  log_seq: string | number;
};

/**
 * One relay tick (ADR 0008): stamp a gap-free log_seq on newly committed events, enqueue one
 * pg-boss job per matching subscriber, then mark the events published. At-least-once:
 * a crash between enqueue and mark re-enqueues, and consumers dedupe via processed_events.
 */
export async function relayOnce(
  boss: PgBoss,
  subscribers: readonly Subscriber[],
  batchSize = 200,
): Promise<number> {
  return withPlatformReader(
    { actor: 'system:relay', reason: 'outbox relay: stamp and publish domain events' },
    async (tx) => {
      await tx.execute(sql`select platform.relay_stamp(${batchSize})`);
      const rows = await tx.execute<Row>(sql`select * from platform.relay_pending(${batchSize})`);
      if (rows.length === 0) return 0;
      for (const r of rows) {
        const event: PublishedEvent = {
          id: r.id,
          orgId: r.org_id,
          type: r.type,
          version: r.version,
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          payload: r.payload,
          logSeq: Number(r.log_seq),
        };
        for (const s of subscribers) {
          if (!s.events.includes(eventKey(event))) continue;
          await boss.send(subscriberQueue(s), { orgId: event.orgId, event }, { singletonKey: event.id });
        }
      }
      const ids = rows.map((r) => r.id);
      await tx.execute(sql`select platform.relay_mark_published(${sql.param(ids)}::uuid[])`);
      return rows.length;
    },
    { callsWritingFunctions: true },
  );
}
