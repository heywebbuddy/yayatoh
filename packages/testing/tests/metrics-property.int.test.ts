import { scanTicketCommand, undoAdmissionCommand } from '@yayatoh/checkin';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { consumeEvent, type PublishedEvent } from '@yayatoh/platform';
import {
  catchUpMetrics,
  eventKpisQuery,
  eventReportQuery,
  METRIC_EVENTS,
  METRICS_CONSUMER,
  metricsProjector,
} from '@yayatoh/reports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs } from '../src/index.ts';
import {
  buy,
  computedState,
  newEvent,
  pay,
  projectedState,
  publish,
  refund,
  ticketsOf,
  typeOf,
} from './metrics-helpers.ts';

/**
 * Property (M3.1a): whatever the operations and however their events are delivered — late, out
 * of order, concurrently, twice — once the projector has caught up, the projection equals a
 * rebuild from the source tables, and the dashboard tiles equal the live report.
 */

/** Deterministic PRNG (mulberry32) so a failing case can be replayed from its seed. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296;
  };
}

let a: OrgFixture;
let admin: AdminSql;
beforeAll(async () => {
  ({ a } = await twoOrgs());
  admin = adminClient();
  await catchUpMetrics(a.org.id);
});
afterAll(async () => {
  await admin?.end();
  await closePools();
});

async function pendingEvents(orgId: string) {
  return admin<PublishedEvent[]>`
    select id, org_id as "orgId", type, version, aggregate_type as "aggregateType",
      aggregate_id as "aggregateId", payload, 0 as "logSeq"
    from platform.domain_events d
    where org_id = ${orgId} and type || '@' || version = any(${[...METRIC_EVENTS]})
      and not exists (select 1 from platform.processed_events p
        where p.org_id = d.org_id and p.consumer = ${METRICS_CONSUMER} and p.event_id = d.id)`;
}

describe('metrics projection property', () => {
  for (const seed of [11, 29, 47, 83]) {
    it(`projection == rebuild after random operations and deliveries (seed ${seed})`, async () => {
      const r = rng(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
      const eventId = await newEvent(a, `Property ${seed}`, 'USD', 'UTC');
      const general = await typeOf(a, eventId, 'General', 2500);
      const vip = await typeOf(a, eventId, 'VIP', 9900);
      const guest = await typeOf(a, eventId, 'Guest', 0, 50);
      await publish(a, eventId);
      const sold: string[] = []; // tickets on paid orders, not refunded
      const admitted: { admissionId: string; ticketId: string }[] = [];
      const orders: { id: string; totalMinor: number; failed: boolean }[] = [];
      const projector = metricsProjector();
      const minute = (base: string, max: number) =>
        new Date(new Date(base).getTime() + Math.floor(r() * max) * 60_000);

      /** Deliver some pending events: shuffled, in concurrent chunks, some twice. */
      const deliver = async (share: number) => {
        const pending = (await pendingEvents(a.org.id)).filter(() => r() < share);
        for (let i = pending.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [pending[i], pending[j]] = [pending[j] as PublishedEvent, pending[i] as PublishedEvent];
        }
        while (pending.length) {
          const chunk = pending.splice(0, 1 + Math.floor(r() * 6));
          const twice = chunk.filter(() => r() < 0.3);
          await Promise.all([...chunk, ...twice].map((e) => consumeEvent(projector, e)));
        }
      };

      for (let step = 0; step < 24; step++) {
        const op = r();
        const buyNow = minute('2028-05-30T10:00:00Z', 600);
        if (op < 0.3) {
          const type = pick([general, general, vip, guest]);
          const o = await buy(
            a,
            eventId,
            [{ ticketTypeId: type, quantity: 1 + Math.floor(r() * 3) }],
            `P${step}`,
            {
              pay: 'succeed',
              now: buyNow,
            },
          );
          orders.push({ ...o, failed: false });
          sold.push(...(await ticketsOf(a, o.id)).map((t) => t.id));
        } else if (op < 0.4) {
          const o = await buy(a, eventId, [{ ticketTypeId: general, quantity: 1 }], `F${step}`, {
            pay: 'fail',
            now: buyNow,
          });
          orders.push({ ...o, failed: true });
        } else if (op < 0.45) {
          const failed = orders.find((o) => o.failed);
          if (failed) {
            await pay(a, failed.id, failed.totalMinor, r() < 0.5 ? 'succeed' : 'none', 'USD', buyNow);
            failed.failed = false;
          }
        } else if (op < 0.6 && sold.length) {
          const ticketId = pick(sold);
          const [row] = await admin<{ order_id: string; total: string }[]>`
            select t.order_id, o.total_minor::text as total from ticketing.tickets t
            join orders.orders o on o.id = t.order_id where t.id = ${ticketId}`;
          if (row && Number(row.total) > 0) {
            await refund(
              a,
              row.order_id,
              { reason: 'requested_by_customer', ticketIds: [ticketId] },
              minute('2028-05-31T08:00:00Z', 300),
            );
            sold.splice(sold.indexOf(ticketId), 1);
          }
        } else if (op < 0.85 && sold.length) {
          const ticketId = pick(sold);
          const [t] = await admin<
            { short_code: string }[]
          >`select short_code from ticketing.tickets where id = ${ticketId}`;
          const res = await executeCommand(
            scanTicketCommand,
            { eventId, code: t?.short_code ?? '' },
            a.ctx({ now: minute('2028-06-01T23:00:00Z', 55) }),
            ports,
          );
          if (res.result === 'admitted' && res.admissionId)
            admitted.push({ admissionId: res.admissionId, ticketId });
        } else if (admitted.length) {
          const x = admitted.splice(Math.floor(r() * admitted.length), 1)[0];
          if (x)
            await executeCommand(
              undoAdmissionCommand,
              { eventId, admissionId: x.admissionId },
              a.ctx({ now: new Date('2028-06-01T23:58:00Z') }),
              ports,
            );
        }
        if (r() < 0.35) await deliver(r());
      }
      await deliver(1);
      await catchUpMetrics(a.org.id);
      expect(await projectedState(a, eventId)).toEqual(await computedState(a, eventId));
      const tiles = await executeQuery(eventKpisQuery, { eventId }, a.ctx(), ports);
      const report = await executeQuery(eventReportQuery, { eventId }, a.ctx(), ports);
      expect(tiles.source).toBe('projection');
      expect(report.hasSales).toBe(true);
      expect(tiles.metrics.map(({ asOf: _a, ...m }) => m)).toEqual(
        report.metrics.map(({ asOf: _a, ...m }) => m),
      );
    }, 120_000);
  }
});
