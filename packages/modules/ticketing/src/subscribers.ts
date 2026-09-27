import { findEventTx } from '@yayatoh/events';
import { defineSubscriber, type Mailer, signLinkToken } from '@yayatoh/platform';
import { z } from 'zod';
import { CLAIM_PURPOSE, HOLDER_PURPOSE } from './distribution.ts';

const ClaimPayload = z.object({ orgId: z.uuid(), claimId: z.uuid(), ticketId: z.uuid(), email: z.email() });
const HolderPayload = z.object({ orgId: z.uuid(), linkId: z.uuid(), eventId: z.uuid(), email: z.email() });

/** Emails a claim link to its recipient. The token is re-derived from the id; the event carries no secret. */
export function claimLinkMailer(deps: { mailer: Mailer; appOrigin: string }) {
  return defineSubscriber({
    name: 'ticketing.claim-mailer',
    events: ['ticket.claim_link_created@1'],
    handle: async (_tx, event) => {
      const p = ClaimPayload.parse(event.payload);
      await deps.mailer.send({
        to: p.email,
        template: 'ticketing.claim-link',
        params: { url: `${deps.appOrigin}/claim/${signLinkToken(CLAIM_PURPOSE, p.claimId)}` },
        idempotencyKey: `claim-link:${p.claimId}`,
      });
    },
  });
}

/** Emails a ticket holder the magic link to their tickets for one event. */
export function holderLinkMailer(deps: { mailer: Mailer; appOrigin: string }) {
  return defineSubscriber({
    name: 'ticketing.holder-link-mailer',
    events: ['ticket.holder_link_created@1'],
    handle: async (tx, event) => {
      const p = HolderPayload.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      await deps.mailer.send({
        to: p.email,
        template: 'ticketing.holder-link',
        params: {
          url: `${deps.appOrigin}/my-tickets/${signLinkToken(HOLDER_PURPOSE, p.linkId)}`,
          eventName: ev?.name ?? '',
        },
        idempotencyKey: `holder-link:${p.linkId}`,
      });
    },
  });
}
