import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { defineSubscriber, type Notifier, signLinkToken } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLAIM_PURPOSE, HOLDER_PURPOSE, issueHolderLinkTx } from './distribution.ts';
import { tickets, ticketTransfers } from './schema.ts';

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

const TransferPayload = z.object({
  orgId: z.uuid(),
  transferId: z.uuid(),
  ticketId: z.uuid(),
  eventId: z.uuid(),
});

async function transferTx(tx: TenantTx, id: string) {
  const [row] = await tx.select().from(ticketTransfers).where(eq(ticketTransfers.id, id));
  return row ?? null;
}

/**
 * M3.10c transfers: the recipient gets the claim link (re-derived from the claim id; the event
 * carries no secret), and once they claim, both sides hear of it: the sender that the ticket is
 * no longer theirs, the recipient with a link to their new ticket. One email each, ever.
 */
export function transferMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'ticketing.transfer-mailer',
    events: ['ticket.transfer_offered@1', 'ticket.transferred@1'],
    handle: async (tx, event) => {
      const p = TransferPayload.parse(event.payload);
      const t = await transferTx(tx, p.transferId);
      if (!t) return;
      const ev = await findEventTx(tx, p.eventId);
      const eventName = ev?.name ?? '';
      const timeZone = ev?.timezone ?? null;
      if (event.type === 'ticket.transfer_offered') {
        if (t.status !== 'pending') return;
        await deps.notifier.enqueue(tx, {
          kind: 'ticketing.transfer-offered',
          to: { email: t.toEmail, name: t.toName, timeZone },
          params: {
            url: `${deps.appOrigin}/claim/${signLinkToken(CLAIM_PURPOSE, t.claimId)}`,
            name: t.toName,
            fromName: t.fromName,
            eventName,
          },
          dedupeKey: `transfer-offered:${t.id}`,
          orderId: t.orderId,
          eventId: p.eventId,
        });
        return;
      }
      const ctx = createCtx({ orgId: p.orgId, actor: { type: 'system', name: 'ticketing.transfer-mailer' } });
      await deps.notifier.enqueue(tx, {
        kind: 'ticketing.transfer-completed',
        to: { email: t.fromEmail, name: t.fromName, timeZone },
        params: { name: t.fromName, toName: t.toName, eventName },
        dedupeKey: `transfer-completed:${t.id}`,
        orderId: t.orderId,
        eventId: p.eventId,
      });
      const link = await issueHolderLinkTx(tx, ctx, p.eventId, t.toEmail);
      await deps.notifier.enqueue(tx, {
        kind: 'ticketing.transfer-received',
        to: { email: t.toEmail, name: t.toName, timeZone },
        params: {
          url: `${deps.appOrigin}/my-tickets/${signLinkToken(HOLDER_PURPOSE, link.id)}`,
          name: t.toName,
          fromName: t.fromName,
          eventName,
        },
        dedupeKey: `transfer-received:${t.id}`,
        orderId: t.orderId,
        eventId: p.eventId,
      });
    },
  });
}
