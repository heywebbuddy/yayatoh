import { findEventTx } from '@yayatoh/events';
import { defineSubscriber, type Notifier } from '@yayatoh/platform';
import { z } from 'zod';

const Requested = z.object({ eventId: z.uuid(), requestId: z.uuid() });

/**
 * QA #20: a new help request reaches the event's door team at once (inbox, and push per their
 * preferences). Until now the bell rang only through the alert engine's "overdue" rule, after the
 * request's SLA and the next sweep, so the organizer heard about it many minutes late.
 */
export function assistanceRequestNotifier(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'assistance.request-notifier',
    events: ['assistance.requested@1'],
    handle: async (tx, event) => {
      const p = Requested.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      if (!ev) return;
      await deps.notifier.notifyMembers(tx, {
        kind: 'assistance.requested',
        params: { eventName: ev.name },
        dedupeKey: `assistance-requested:${p.requestId}`,
        href: `/e/${ev.slug}/assistance`,
        eventId: ev.id,
      });
    },
  });
}
