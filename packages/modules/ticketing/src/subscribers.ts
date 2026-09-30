import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { defineSubscriber, type Notifier, signLinkToken } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLAIM_PURPOSE, HOLDER_PURPOSE } from './distribution.ts';
import { tickets } from './schema.ts';

async function ticketEventIdTx(tx: TenantTx, ticketId: string): Promise<string | null> {
  const [row] = await tx.select({ eventId: tickets.eventId }).from(tickets).where(eq(tickets.id, ticketId));
  return row?.eventId ?? null;
}

const ClaimPayload = z.object({ orgId: z.uuid(), claimId: z.uuid(), ticketId: z.uuid(), email: z.email() });
const HolderPayload = z.object({ orgId: z.uuid(), linkId: z.uuid(), eventId: z.uuid(), email: z.email() });

/** Emails a claim link to its recipient. The token is re-derived from the id; the event carries no secret. */
export function claimLinkMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'ticketing.claim-mailer',
    events: ['ticket.claim_link_created@1'],
    handle: async (tx, event) => {
      const p = ClaimPayload.parse(event.payload);
      const eventId = await ticketEventIdTx(tx, p.ticketId);
      const ev = eventId ? await findEventTx(tx, eventId) : null;
      await deps.notifier.enqueue(tx, {
        kind: 'ticketing.claim-link',
        to: { email: p.email, timeZone: ev?.timezone ?? null },
        params: {
          url: `${deps.appOrigin}/claim/${signLinkToken(CLAIM_PURPOSE, p.claimId)}`,
          eventName: ev?.name ?? '',
        },
        dedupeKey: `claim-link:${p.claimId}`,
        eventId,
      });
    },
  });
}

/** Emails a ticket holder the magic link to their tickets for one event. */
export function holderLinkMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'ticketing.holder-link-mailer',
    events: ['ticket.holder_link_created@1'],
    handle: async (tx, event) => {
      const p = HolderPayload.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      await deps.notifier.enqueue(tx, {
        kind: 'ticketing.holder-link',
        to: { email: p.email, timeZone: ev?.timezone ?? null },
        params: {
          url: `${deps.appOrigin}/my-tickets/${signLinkToken(HOLDER_PURPOSE, p.linkId)}`,
          eventName: ev?.name ?? '',
        },
        dedupeKey: `holder-link:${p.linkId}`,
        eventId: p.eventId,
      });
    },
  });
}
