import { findEventTx } from '@yayatoh/events';
import { createCtx, type DomainEvent } from '@yayatoh/kernel';
import { defineSubscriber, emitEvents, type Notifier, type Subscriber } from '@yayatoh/platform';
import { ticketsByIdsTx } from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  cancelRegistrantsWithoutTicketTx,
  confirmRegistrantsForOrderTx,
  registrantToken,
  releaseRegistrantsForOrderTx,
} from './registrant-records.ts';
import { registrants, registrationTypes } from './schema.ts';

/**
 * `registration.registrants` (outbox): keeps registrants in step with their orders. Paid →
 * confirmed with their own named ticket; lapsed → reserved ones cancelled, approved applicants keep
 * their approval; refunded or tickets cancelled → registrants without a valid ticket cancelled.
 * Idempotent (every step re-reads the order's state).
 */
export function registrantLifecycle(): Subscriber {
  return defineSubscriber({
    name: 'registration.registrants',
    events: [
      'order.paid@1',
      'order.expired@1',
      'order.payment_orphaned@1',
      'order.refunded@1',
      'tickets.cancelled@1',
      // M5.1d: a voided invoice ends its registrants (their tickets were voided with it).
      'order.voided@1',
    ],
    handle: async (tx, event) => {
      const ctx = createCtx({
        orgId: event.orgId,
        actor: { type: 'system', name: 'registration.registrants' },
      });
      const out: DomainEvent[] = [];
      const p = (event.payload ?? {}) as { orderId?: string; ticketIds?: string[] };
      if (event.type === 'order.paid' && p.orderId)
        await confirmRegistrantsForOrderTx(tx, ctx, (e) => void out.push(e), p.orderId);
      if ((event.type === 'order.expired' || event.type === 'order.payment_orphaned') && p.orderId)
        await releaseRegistrantsForOrderTx(tx, ctx, p.orderId);
      if ((event.type === 'order.refunded' || event.type === 'order.voided') && p.orderId)
        await cancelRegistrantsWithoutTicketTx(tx, ctx, p.orderId);
      if (event.type === 'tickets.cancelled' && Array.isArray(p.ticketIds)) {
        const orderIds = new Set(
          (await ticketsByIdsTx(tx, p.ticketIds)).map((t) => t.orderId).filter(Boolean) as string[],
        );
        for (const id of [...orderIds].sort()) await cancelRegistrantsWithoutTicketTx(tx, ctx, id);
      }
      await emitEvents(tx, ctx, out);
    },
  });
}

const DecisionPayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  registrantId: z.uuid(),
  decidedAt: z.string(),
});

/** The dedupe key of one decision's email: a replayed event never emails twice. */
export const decisionDedupeKey = (registrantId: string, decision: 'approved' | 'denied', decidedAt: string) =>
  `registration-decision:${registrantId}:${decision}:${decidedAt}`;

/**
 * Approval and denial emails (transactional, M5.1c): approved → the applicant's link (pay step
 * for a paid pass, else their confirmation); denied → the organizer's reason. Sent only while the
 * decision still stands (a later change of mind sends its own email).
 */
export function decisionMailer(deps: { notifier: Notifier; appOrigin: string }): Subscriber {
  return defineSubscriber({
    name: 'registration.decision-mailer',
    events: ['registration.registrant.approved@1', 'registration.registrant.denied@1'],
    handle: async (tx, event) => {
      const p = DecisionPayload.parse(event.payload);
      const decision = event.type === 'registration.registrant.approved' ? 'approved' : 'denied';
      const [r] = await tx.select().from(registrants).where(eq(registrants.id, p.registrantId));
      if (!r) return;
      const stands =
        decision === 'denied' ? r.status === 'denied' : ['approved', 'confirmed'].includes(r.status);
      if (!stands || r.decidedAt?.toISOString() !== p.decidedAt) return;
      const ev = await findEventTx(tx, r.eventId);
      const [type] = await tx
        .select({ name: registrationTypes.name })
        .from(registrationTypes)
        .where(eq(registrationTypes.id, r.registrationTypeId));
      if (!ev || !type) return;
      await deps.notifier.enqueue(tx, {
        kind: decision === 'approved' ? 'registration.approved' : 'registration.denied',
        to: { email: r.email, name: r.name, locale: r.locale },
        params: {
          url: `${deps.appOrigin}/events/${ev.slug}/registration/${registrantToken(r.id)}`,
          name: r.name,
          eventName: ev.name,
          typeName: type.name,
          ...(r.decisionReason ? { body: r.decisionReason } : {}),
        },
        dedupeKey: decisionDedupeKey(r.id, decision, p.decidedAt),
        eventId: r.eventId,
      });
    },
  });
}
