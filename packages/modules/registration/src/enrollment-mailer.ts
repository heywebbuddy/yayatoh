import { findEventTx } from '@yayatoh/events';
import { orderManageTokenTx } from '@yayatoh/orders';
import { defineSubscriber, type Notifier } from '@yayatoh/platform';
import { enrollableSessionsByIdTx } from '@yayatoh/program';
import { ticketsByIdsTx } from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sessionEnrollments } from './schema.ts';

const Payload = z.object({
  enrollmentId: z.uuid(),
  status: z.enum(['enrolled', 'offered']),
  offer: z.int().default(0),
});

// The order's locale came from the request; only a well-formed tag goes into a URL.
const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

/**
 * P5-9: someone moved off a session's line hears it at once — "you're enrolled" (auto) or "a place
 * is yours until …" (offer) — with the link to their schedule (the order's manage link, decrypted
 * here, never in the payload). Skipped when the entry moved on meanwhile; one email per entry and
 * offer (dedupe keys).
 */
export function enrollmentMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'registration.enrollment-mailer',
    events: ['registration.session.promoted@1'],
    handle: async (tx, event) => {
      const p = Payload.parse(event.payload);
      const [e] = await tx.select().from(sessionEnrollments).where(eq(sessionEnrollments.id, p.enrollmentId));
      if (!e || e.status !== p.status) return;
      if (p.status === 'offered' && (e.offerCount !== p.offer || !e.offerExpiresAt)) return;
      const ev = await findEventTx(tx, e.eventId);
      const [s] = await enrollableSessionsByIdTx(tx, [e.sessionId]);
      const [ticket] = await ticketsByIdsTx(tx, [e.registrantId]);
      const link = await orderManageTokenTx(tx, e.orgId, e.orderId);
      if (!ev || !s || !ticket || !link) return;
      const url = `${deps.appOrigin}${localePrefix(link.locale)}/orders/${link.token}/schedule?registrant=${e.registrantId}`;
      const to = {
        email: ticket.holderEmail,
        name: ticket.holderName,
        locale: link.locale,
        timeZone: ev.timezone,
      };
      const base = {
        url,
        name: ticket.holderName,
        eventName: ev.name,
        sessionTitle: s.title,
        startsAt: s.startsAt.toISOString(),
        timeZone: ev.timezone,
      };
      if (p.status === 'enrolled')
        await deps.notifier.enqueue(tx, {
          kind: 'registration.session-enrolled',
          to,
          params: base,
          dedupeKey: `session-enrolled:${e.id}`,
          eventId: e.eventId,
        });
      else
        await deps.notifier.enqueue(tx, {
          kind: 'registration.session-offer',
          to,
          params: { ...base, until: e.offerExpiresAt?.toISOString() ?? '' },
          dedupeKey: `session-offer:${e.id}:${p.offer}`,
          eventId: e.eventId,
        });
    },
  });
}
