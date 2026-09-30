import type { TenantTx } from '@yayatoh/db';
import { orderMetricRefTx } from '@yayatoh/orders';
import { defineSubscriber, eventKey, type PublishedEvent, type Subscriber } from '@yayatoh/platform';
import { z } from 'zod';
import { analyticsEvents } from './schema.ts';

/**
 * The analytics sink (M3.1, decision P3-4): product analytics leave the transactional tables
 * only as these allowlisted events. No personal data: no names, emails, phone numbers, addresses,
 * free text or ids of people (buyers, holders, attendees, tickets, orders) — only the org, the
 * event and the listed properties. A property not listed here is dropped by the parse.
 */
const Currency = z.string().regex(/^[A-Z]{3}$/);
const Base = {
  orgId: z.uuid(),
  eventId: z.uuid().nullable(),
  occurredAt: z.date(),
  /** The domain event this came from (deduplication), not a person. */
  sourceEventId: z.uuid(),
  /** Backfilled history (legacy migration): kept apart in analyses of live behaviour. */
  replayed: z.boolean(),
};
export const AnalyticsEvent = z.discriminatedUnion('name', [
  z.object({
    ...Base,
    name: z.literal('order_paid'),
    props: z.object({
      currency: Currency,
      totalMinor: z.int().nonnegative(),
      channel: z.enum(['online', 'organizer', 'free']),
    }),
  }),
  z.object({
    ...Base,
    name: z.literal('order_refunded'),
    props: z.object({
      currency: Currency,
      amountMinor: z.int().nonnegative(),
      tickets: z.int().nonnegative(),
      fully: z.boolean(),
    }),
  }),
  z.object({ ...Base, name: z.literal('payment_failed'), props: z.object({}) }),
  z.object({ ...Base, name: z.literal('ticket_admitted'), props: z.object({ offline: z.boolean() }) }),
  z.object({ ...Base, name: z.literal('event_published'), props: z.object({}) }),
]);
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>;
export const ANALYTICS_EVENT_NAMES = [
  'order_paid',
  'order_refunded',
  'payment_failed',
  'ticket_admitted',
  'event_published',
] as const satisfies readonly AnalyticsEvent['name'][];

/**
 * Where analytics events go. The Postgres sink writes inside the caller's tenant transaction (so
 * the forwarder stays exactly-once); a warehouse adapter (ClickHouse or Tinybird, M6.2) will
 * implement the same port. Every implementation parses through `AnalyticsEvent` first.
 */
export interface AnalyticsSink {
  readonly name: string;
  emit(tx: TenantTx, event: AnalyticsEvent): Promise<void>;
}

/** Append-only Postgres sink (`reports.analytics_events`), deduplicated by (org, source event, name). */
export const postgresAnalyticsSink: AnalyticsSink = {
  name: 'postgres',
  async emit(tx, event) {
    const e = AnalyticsEvent.parse(event);
    await tx
      .insert(analyticsEvents)
      .values({
        orgId: e.orgId,
        name: e.name,
        eventId: e.eventId,
        occurredAt: e.occurredAt,
        sourceEventId: e.sourceEventId,
        replayed: e.replayed,
        props: e.props,
      })
      .onConflictDoNothing();
  },
};

/** In-memory sink for tests and development. */
export function fakeAnalyticsSink(): AnalyticsSink & { readonly events: AnalyticsEvent[] } {
  const events: AnalyticsEvent[] = [];
  return {
    name: 'fake',
    events,
    async emit(_tx, event) {
      events.push(AnalyticsEvent.parse(event));
    },
  };
}

/** Domain events forwarded to the sink. */
export const ANALYTICS_SOURCE_EVENTS = [
  'order.paid@1',
  'order.refunded@1',
  'order.payment_failed@1',
  'ticket.admitted@1',
  'event.published@1',
] as const;

const P = z.looseObject({
  eventId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  currency: z.string().optional(),
  totalMinor: z.int().optional(),
  amountMinor: z.int().optional(),
  tickets: z.int().optional(),
  fully: z.boolean().optional(),
  via: z.string().optional(),
  offline: z.boolean().optional(),
});

/** Map one domain event to its analytics event (allowlisted properties only), or null. */
export async function toAnalyticsEventTx(
  tx: TenantTx,
  event: PublishedEvent,
): Promise<AnalyticsEvent | null> {
  const p = P.parse(event.payload ?? {});
  let eventId = p.eventId ?? null;
  if (!eventId && p.orderId) eventId = (await orderMetricRefTx(tx, p.orderId))?.eventId ?? null;
  const base = {
    orgId: event.orgId,
    eventId,
    occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
    sourceEventId: event.id,
    replayed: event.replayed === true,
  };
  switch (eventKey(event)) {
    case 'order.paid@1':
      return {
        ...base,
        name: 'order_paid',
        props: {
          currency: p.currency ?? '',
          totalMinor: p.totalMinor ?? 0,
          channel: p.via === 'box_office' ? 'organizer' : p.via === 'free' ? 'free' : 'online',
        },
      };
    case 'order.refunded@1':
      return {
        ...base,
        name: 'order_refunded',
        props: {
          currency: p.currency ?? '',
          amountMinor: p.amountMinor ?? 0,
          tickets: p.tickets ?? 0,
          fully: p.fully === true,
        },
      };
    case 'order.payment_failed@1':
      return { ...base, name: 'payment_failed', props: {} };
    case 'ticket.admitted@1':
      return { ...base, name: 'ticket_admitted', props: { offline: p.offline === true } };
    case 'event.published@1':
      return { ...base, name: 'event_published', props: {} };
    default:
      return null;
  }
}

/**
 * Forward selected domain events to the analytics sink (worker). Backfilled history is forwarded
 * too, flagged `replayed`: analytics is a projection, not a side effect a person notices.
 */
export function analyticsForwarder(sink: AnalyticsSink = postgresAnalyticsSink): Subscriber {
  return defineSubscriber({
    name: 'reports.analytics',
    events: [...ANALYTICS_SOURCE_EVENTS],
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const e = await toAnalyticsEventTx(tx, event);
      if (e) await sink.emit(tx, e);
    },
  });
}
