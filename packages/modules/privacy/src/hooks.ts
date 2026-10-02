import { catchUpSubscriber, defineSubscriber, erasureConnectorHooks, type Subscriber } from '@yayatoh/platform';
import { z } from 'zod';

const Payload = z.object({ requestId: z.uuid(), subjectRef: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * M6.1c: after an erasure commits, every registered connector hook (M6.4 integrations: Mailchimp,
 * HubSpot …) is told to erase the person in the third party too, by the hashed address. At least
 * once (the outbox); hooks must be idempotent. None are registered until M6.4.
 */
export function erasureConnectorNotifier(): Subscriber {
  return defineSubscriber({
    name: 'privacy.connector-hooks',
    events: ['privacy.subject_erased@1'],
    handle: async (_tx, event) => {
      const p = Payload.parse(event.payload);
      for (const hook of erasureConnectorHooks())
        await hook.onErased({ orgId: event.orgId, requestId: p.requestId, subjectRef: p.subjectRef });
    },
  });
}

export function catchUpErasureHooks(orgId: string): Promise<number> {
  return catchUpSubscriber(erasureConnectorNotifier(), orgId);
}
