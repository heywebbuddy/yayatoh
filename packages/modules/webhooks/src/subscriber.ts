import { effectiveModulesTx } from '@yayatoh/billing';
import { defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { entryForSource, envelope, PUBLIC_SOURCES, toPublicData } from './catalog.ts';
import type { WebhookPublisher } from './port.ts';
import { endpoints } from './schema.ts';

/**
 * Outbox → webhooks (M6.3b, roadmap §6.3). Every catalog source is serialized through its thin
 * schema (the allowlist) and handed to the publisher with the outbox event id as the message's
 * idempotency id, so a relay retry is one message. Orgs without an active endpoint, or without the
 * `api_access` module, send nothing. Backfilled history (`replayed`) is never sent.
 *
 * A payload that does not fit its schema throws: the event is retried and then dead-lettered by
 * the relay rather than sent half-checked.
 */
export function webhookPublisherSubscriber(opts: { publisher: () => WebhookPublisher | null }): Subscriber {
  return defineSubscriber({
    name: 'webhooks.publish',
    events: PUBLIC_SOURCES,
    handle: async (tx, event) => {
      const entry = entryForSource(`${event.type}@${event.version}`);
      const publisher = opts.publisher();
      if (!entry || !publisher) return;
      const [active] = await tx
        .select({ id: endpoints.id })
        .from(endpoints)
        .where(eq(endpoints.status, 'active'))
        .limit(1);
      if (!active) return;
      if (!(await effectiveModulesTx(tx)).has('api_access')) return;
      const data = toPublicData(entry, event.payload);
      const message = envelope(
        entry,
        { id: event.id, orgId: event.orgId, occurredAt: event.occurredAt ?? new Date().toISOString() },
        data,
      );
      await publisher.sendMessage(event.orgId, {
        eventType: entry.type,
        eventId: event.id,
        payload: { ...message },
      });
    },
  });
}
