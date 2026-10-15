import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { normalizeEmail } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { createCtx, DomainError, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { guestOrders, myOrderDetail, myOrderRefundTarget, requestRefundCommand } from '@yayatoh/orders';
import { organizationNameTx } from '@yayatoh/tenancy';
import {
  cancelAppTransferCommand,
  claimContext,
  claimDetailsQuery,
  claimTicketForPersonCommand,
  fakeWalletPassProvider,
  holderContext,
  holderTicketsQuery,
  holderWalletPassTx,
  issueAppHolderLinkCommand,
  markWalletPassesPushedTx,
  startAppTransferCommand,
  type WalletPassProvider,
} from '@yayatoh/ticketing';
import { cachedJson, SENSITIVE_CACHE } from '../caching.ts';
import type { V1Deps, V1Env } from '../context.ts';
import { newestFirst, pageByKey } from '../cursor.ts';
import {
  BuyerRefundRequest,
  ClaimDetails,
  ClaimRequest,
  MyOrder,
  MyOrderPage,
  MyTicket,
  MyTicketPage,
  RefundRequestInput,
  TicketLinkTickets,
  TicketTransferResult,
  TransferTicketRequest,
  WalletPassLink,
  WalletPlatform,
} from '../me/resources.ts';
import {
  orgCtx,
  type PersonTicket,
  type PersonTicketDetail,
  personKey,
  personTicket,
  personTickets,
} from '../me/service.ts';
import { toWire } from '../resources.ts';
import { resolveMobile } from '../versions.ts';
import {
  body,
  IdempotencyHeader,
  idempotent,
  json,
  notModified,
  PageQuery,
  problems,
  userSecurity,
  writeProblems,
} from './common.ts';

/**
 * The signed-in person's tickets, orders, transfers, refund requests, wallet passes and claims
 * (M7.2b), under the `/me/…` scope (a user session with a verified email; `claims` mounts the same
 * guard). The person is their session's verified address and nothing else: no id or email in a path
 * or body ever names whose tickets these are. Reads come from the same queries as the web's "My
 * tickets"; every write goes through the same commands (the transfer and claim ones keyed by the
 * session's address instead of a holder link).
 */

const TicketParams = z.object({
  id: z.uuid().openapi({ param: { name: 'id', in: 'path' }, description: 'The ticket id' }),
});
const OrderParams = z.object({
  id: z.uuid().openapi({ param: { name: 'id', in: 'path' }, description: 'The order id' }),
});
const TransferParams = TicketParams.extend({
  transferId: z.uuid().openapi({ param: { name: 'transferId', in: 'path' }, description: 'The transfer id' }),
});
const ClaimParams = z.object({
  token: z
    .string()
    .min(10)
    .max(200)
    .openapi({ param: { name: 'token', in: 'path' }, description: 'The claim link’s token' }),
});
const TicketLinkParams = z.object({
  token: z
    .string()
    .min(10)
    .max(300)
    .openapi({ param: { name: 'token', in: 'path' }, description: 'The token of a web “My tickets” link' }),
});
const TicketWhen = z.enum(['upcoming', 'past']).openapi('TicketWhen', {
  description: '`upcoming`: not yet over, soonest first. `past`: over, latest first.',
});
const TicketsQuery = PageQuery.extend({
  when: TicketWhen.default('upcoming').openapi({ param: { description: 'Which tickets to list' } }),
});
const WalletQuery = z.object({
  platform: WalletPlatform.openapi({ param: { description: 'Which wallet app to add the pass to' } }),
});

const routes = {
  listTickets: createRoute({
    method: 'get',
    path: '/me/tickets',
    operationId: 'listMyTickets',
    tags: ['me'],
    summary: 'My tickets: upcoming or past',
    description:
      'The active tickets held by the signed-in person’s verified email, across organizers: the same tickets the web’s My tickets shows. `upcoming` (not yet over, soonest first) or `past` (latest first), with keyset paging. Codes are not listed; open a ticket for its QR code. Needs a verified email.',
    security: userSecurity,
    request: { query: TicketsQuery },
    responses: { 200: json(MyTicketPage, 'A page of tickets'), ...notModified, ...problems },
  }),
  getTicket: createRoute({
    method: 'get',
    path: '/me/tickets/{id}',
    operationId: 'getMyTicket',
    tags: ['me'],
    summary: 'One of my tickets: QR code, seat, entrances, event, venue, branding and transfer options',
    description:
      'The ticket’s QR code string, short code, `rev` and status; its type, seat and the entrances and zones where it is checked; the event (instants plus its time zone) and venue; the organizer’s branding for theming; and what the holder may do (transfer, with its cutoff and fee). Send `If-None-Match` with the `ETag` for a 304. A ticket that is not yours is a `404`.',
    security: userSecurity,
    request: { params: TicketParams },
    responses: { 200: json(MyTicket, 'The ticket'), ...notModified, ...problems },
  }),
  ticketLink: createRoute({
    method: 'get',
    path: '/me/ticket-links/{token}',
    operationId: 'getMyTicketLink',
    tags: ['me'],
    summary: 'Which of my tickets a web ticket link opens',
    description:
      'The “My tickets” link in an order email names one event and the address it was sent to. For the signed-in person that address belongs to, this returns the ids of their active tickets for that event, so the app can open the ticket after sign-in. For an unknown or expired link, or when the link was sent to a different address, the answer is a `404` and nothing about the link is shown. Ticket codes in the link are never returned.',
    security: userSecurity,
    request: { params: TicketLinkParams },
    responses: { 200: json(TicketLinkTickets, 'The tickets the link opens'), ...notModified, ...problems },
  }),
  startTransfer: createRoute({
    method: 'post',
    path: '/me/tickets/{id}/transfers',
    operationId: 'startMyTicketTransfer',
    tags: ['me'],
    summary: 'Transfer a ticket to someone by name and email',
    description:
      'Starts a transfer under the ticket type’s rules (`transfersAllowed`, the cutoff before the event). The recipient is emailed a claim link and the ticket stays yours until they claim it, which retires your code and wallet pass. If the ticket type charges a transfer fee, nothing is started: `web_payment_required` returns a link to agree to and pay it on the web. Needs an `Idempotency-Key`.',
    security: userSecurity,
    request: { params: TicketParams, headers: IdempotencyHeader, ...body(TransferTicketRequest) },
    responses: {
      200: json(TicketTransferResult, 'A transfer fee is paid on the web: nothing was started'),
      201: json(TicketTransferResult, 'The transfer was started'),
      ...writeProblems,
    },
  }),
  cancelTransfer: createRoute({
    method: 'delete',
    path: '/me/tickets/{id}/transfers/{transferId}',
    operationId: 'cancelMyTicketTransfer',
    tags: ['me'],
    summary: 'Cancel a pending transfer',
    description:
      'Cancels your pending transfer of this ticket before it is claimed; the claim link stops working. Needs an `Idempotency-Key`.',
    security: userSecurity,
    request: { params: TransferParams, headers: IdempotencyHeader },
    responses: { 204: { description: 'Cancelled' }, ...writeProblems },
  }),
  wallet: createRoute({
    method: 'get',
    path: '/me/tickets/{id}/wallet',
    operationId: 'getMyTicketWalletPass',
    tags: ['me'],
    summary: 'Add a ticket to Apple Wallet or Google Wallet',
    description:
      'A link to add the ticket’s pass to the chosen wallet, from the pass provider. Until the platform’s wallet accounts exist the provider is a fake and the link is a placeholder. A transfer voids the sender’s pass. Only an active ticket you hold has one.',
    security: userSecurity,
    request: { params: TicketParams, query: WalletQuery },
    responses: { 200: json(WalletPassLink, 'The pass link'), ...problems },
  }),
  listOrders: createRoute({
    method: 'get',
    path: '/me/orders',
    operationId: 'listMyOrders',
    tags: ['me'],
    summary: 'My orders, newest first',
    description:
      'The orders bought with the signed-in person’s verified email (paid, partially refunded or refunded), across organizers, from the same source as the web’s My tickets. Keyset paging.',
    security: userSecurity,
    request: { query: PageQuery },
    responses: { 200: json(MyOrderPage, 'A page of orders'), ...notModified, ...problems },
  }),
  getOrder: createRoute({
    method: 'get',
    path: '/me/orders/{id}',
    operationId: 'getMyOrder',
    tags: ['me'],
    summary: 'One of my orders: lines, totals, refund policy and refund-request status',
    description:
      'The order’s lines and totals in minor units, the refund terms it was bought under, whether a refund can be requested now and the latest request’s status, and the tickets you still hold. An order that is not yours is a `404`.',
    security: userSecurity,
    request: { params: OrderParams },
    responses: { 200: json(MyOrder, 'The order'), ...notModified, ...problems },
  }),
  requestRefund: createRoute({
    method: 'post',
    path: '/me/orders/{id}/refund-requests',
    operationId: 'requestMyOrderRefund',
    tags: ['me'],
    summary: 'Ask the organizer for a refund',
    description:
      'Asks for a refund of the tickets you hold (all of them when `ticketIds` is empty), within the policy the order was bought under; one open request per order. The organizer is told and has five business days to answer. Needs an `Idempotency-Key`.',
    security: userSecurity,
    request: { params: OrderParams, headers: IdempotencyHeader, ...body(RefundRequestInput) },
    responses: { 201: json(BuyerRefundRequest, 'The request'), ...writeProblems },
  }),
  getClaim: createRoute({
    method: 'get',
    path: '/claims/{token}',
    operationId: 'getTicketClaim',
    tags: ['me'],
    summary: 'What a claim link offers',
    description:
      'What a ticket claim link (or a transfer’s link) offers: its state, the event, the ticket type, and for a transfer who sent it and who it is for. The signed-in person must have a verified email. No ticket code is shown before claiming.',
    security: userSecurity,
    request: { params: ClaimParams },
    responses: { 200: json(ClaimDetails, 'The claim'), ...notModified, ...problems },
  }),
  claim: createRoute({
    method: 'post',
    path: '/claims/{token}',
    operationId: 'claimTicket',
    tags: ['me'],
    summary: 'Claim the ticket',
    description:
      'Claims the ticket for the signed-in person’s verified email: it is reissued to you and the previous holder’s code and wallet pass stop working. A transfer can only be claimed with the address it was sent to. Needs an `Idempotency-Key`. Returns the ticket.',
    security: userSecurity,
    request: { params: ClaimParams, headers: IdempotencyHeader, ...body(ClaimRequest) },
    responses: { 200: json(MyTicket, 'The claimed ticket'), ...writeProblems },
  }),
};

const startOf = (t: PersonTicket['ticket']) => t.date?.startsAt ?? t.event.startsAt;
const endOf = (t: PersonTicket['ticket']) => t.date?.endsAt ?? t.event.endsAt;

const summaryOf = (p: PersonTicket) => ({
  id: p.ticket.id,
  orderId: p.ticket.orderId,
  status: p.ticket.status,
  rev: p.ticket.rev,
  shortCode: p.ticket.shortCode,
  serial: p.ticket.serial,
  holderName: p.ticket.holderName,
  ticketTypeName: p.ticket.ticketTypeName,
  seatLabel: p.ticket.seatLabel,
  date: p.ticket.date,
  event: p.ticket.event,
  organizerName: p.organizerName,
  accentColor: p.brand.accentColor,
  pendingTransfer: p.ticket.transfer.pendingTransferId !== null,
});

export function meRoutes(deps: V1Deps) {
  const { ports } = deps;
  const fallbackWallet = fakeWalletPassProvider();
  const wallet = (): WalletPassProvider => deps.walletPasses?.() ?? fallbackWallet;
  const origin = (c: { req: { url: string } }) =>
    (deps.publicOrigin ?? new URL(c.req.url).origin).replace(/\/$/, '');
  const webBase = () => resolveMobile(deps.mobile).baseUrls.web.replace(/\/$/, '');

  const detailWire = (c: { req: { url: string } }, d: PersonTicketDetail) =>
    toWire(MyTicket, {
      ...summaryOf(d),
      qrCode: d.ticket.qrCode,
      ticketTypeId: d.ticket.ticketTypeId,
      checkpoints: d.checkpoints,
      venue: d.venue,
      branding: {
        organizerName: d.organizerName,
        logoUrl: d.brand.logoPath ? `${origin(c)}${d.brand.logoPath}` : null,
        logoAlt: d.brand.logoAlt,
        accentColor: d.brand.accentColor,
        poweredByVisible: d.brand.poweredByVisible,
      },
      transfer: { ...d.ticket.transfer, feeRequiresWeb: d.ticket.transfer.feeMinor > 0 },
    });

  return new OpenAPIHono<V1Env>()
    .openapi(routes.listTickets, async (c) => {
      const { limit, cursor, when } = c.req.valid('query');
      const now = c.get('me').ctx.now;
      const upcoming = when === 'upcoming';
      const mine = (await personTickets(c.get('me').user.email)).filter(
        (p) => p.ticket.status === 'active' && endOf(p.ticket) > now === upcoming,
      );
      const page = pageByKey(mine, limit, cursor, (p) => [
        upcoming ? startOf(p.ticket).toISOString() : newestFirst(startOf(p.ticket)),
        p.ticket.id,
      ]);
      return cachedJson(
        c,
        toWire(MyTicketPage, { data: page.data.map(summaryOf), nextCursor: page.nextCursor }),
        SENSITIVE_CACHE,
      );
    })
    .openapi(routes.getTicket, async (c) => {
      const found = await personTicket(c.get('me').user.email, c.req.valid('param').id);
      if (!found) throw new DomainError('not_found', 'Ticket not found');
      return cachedJson(c, detailWire(c, found), SENSITIVE_CACHE);
    })
    .openapi(routes.ticketLink, async (c) => {
      const me = c.get('me');
      const notFound = () => new DomainError('not_found', 'This link is not valid');
      const holder = await holderContext(c.req.valid('param').token);
      if (!holder) throw notFound();
      const data = await executeQuery(holderTicketsQuery, { linkId: holder.id }, holder.ctx, ports).catch(
        (err: unknown) => {
          if (isDomainError(err) && err.code === 'not_found') return null;
          throw err;
        },
      );
      // The link works for the address it was sent to and nobody else: a different account gets
      // the same answer as an unknown link.
      if (!data || normalizeEmail(data.email) !== personKey(me.user.email)) throw notFound();
      return cachedJson(
        c,
        toWire(TicketLinkTickets, { ticketIds: data.tickets.map((t) => t.id) }),
        SENSITIVE_CACHE,
      );
    })
    .openapi(routes.startTransfer, async (c) => {
      const me = c.get('me');
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const found = await personTicket(me.user.email, id);
      if (!found) throw new DomainError('not_found', 'Ticket not found');
      const ctx = orgCtx(me.ctx, found.orgId);
      const t = found.ticket.transfer;
      // A transfer fee is agreed and paid on the web: send the person there. Only when the rules
      // would otherwise allow the transfer; a refused one gets the command's own refusal below.
      if (t.allowed && t.feeMinor > 0) {
        // Not idempotent on purpose: its answer is a web credential, which the idempotency record
        // would keep for a day. It is limited like every holder link (three an hour per event).
        const link = await executeCommand(
          issueAppHolderLinkCommand,
          { holderEmail: me.user.email, ticketId: id },
          ctx,
          ports,
        );
        return c.json(
          toWire(TicketTransferResult, {
            status: 'web_payment_required',
            transferId: null,
            feeMinor: t.feeMinor,
            currency: t.currency,
            webUrl: `${webBase()}/my-tickets/${link.token}`,
          }),
          200,
        );
      }
      const r = await executeCommand(
        idempotent(startAppTransferCommand),
        { holderEmail: me.user.email, ticketId: id, toName: input.toName, toEmail: input.toEmail },
        ctx,
        ports,
      );
      return c.json(
        toWire(TicketTransferResult, {
          status: 'started',
          transferId: r.transferId,
          feeMinor: r.feeMinor,
          currency: t.currency,
          webUrl: null,
        }),
        201,
      );
    })
    .openapi(routes.cancelTransfer, async (c) => {
      const me = c.get('me');
      const { id, transferId } = c.req.valid('param');
      const found = await personTicket(me.user.email, id);
      if (!found) throw new DomainError('not_found', 'Ticket not found');
      await executeCommand(
        idempotent(cancelAppTransferCommand),
        { holderEmail: me.user.email, ticketId: id, transferId },
        orgCtx(me.ctx, found.orgId),
        ports,
      );
      return c.body(null, 204);
    })
    .openapi(routes.wallet, async (c) => {
      const me = c.get('me');
      const { id } = c.req.valid('param');
      const { platform } = c.req.valid('query');
      const found = await personTicket(me.user.email, id);
      if (!found || found.ticket.status !== 'active') throw new DomainError('not_found', 'Ticket not found');
      const orgId = found.orgId;
      const provider = wallet();
      const ctx = orgCtx(me.ctx, orgId);
      const pass = await withTenant(ctx, (tx) => holderWalletPassTx(tx, ctx, personKey(me.user.email), id));
      if (!pass) throw new DomainError('not_found', 'Ticket not found');
      if (!pass.pushed) {
        const r = await provider.upsertPass({
          serial: pass.serial,
          ticketId: pass.ticketId,
          rev: pass.rev,
          holderName: pass.holderName,
          eventName: pass.eventName,
        });
        if (r.ok) await withTenant(ctx, (tx) => markWalletPassesPushedTx(tx, [pass.id], new Date()));
      }
      const link = await provider.passLink({ platform, serial: pass.serial });
      if (!link) throw new DomainError('not_found', 'This wallet is not available for the ticket');
      return c.json(toWire(WalletPassLink, { platform, url: link.url, serial: pass.serial }), 200);
    })
    .openapi(routes.listOrders, async (c) => {
      const { limit, cursor } = c.req.valid('query');
      const orders = await guestOrders(c.get('me').user.email, null);
      const page = pageByKey(orders, limit, cursor, (o) => [newestFirst(o.createdAt), o.orderId]);
      return cachedJson(
        c,
        toWire(MyOrderPage, {
          data: page.data.map((o) => ({
            id: o.orderId,
            organizerName: o.orgName,
            eventId: o.eventId,
            eventName: o.eventName,
            startsAt: o.startsAt,
            endsAt: o.endsAt,
            timezone: o.timeZone,
            status: o.status,
            tickets: o.tickets,
            totalMinor: o.totalMinor,
            currency: o.currency,
            createdAt: o.createdAt,
          })),
          nextCursor: page.nextCursor,
        }),
        SENSITIVE_CACHE,
      );
    })
    .openapi(routes.getOrder, async (c) => {
      const order = await myOrderDetail(c.get('me').user.email, c.req.valid('param').id);
      if (!order) throw new DomainError('not_found', 'Order not found');
      return cachedJson(c, toWire(MyOrder, { ...order, organizerName: order.orgName }), SENSITIVE_CACHE);
    })
    .openapi(routes.requestRefund, async (c) => {
      const me = c.get('me');
      const input = c.req.valid('json');
      const target = await myOrderRefundTarget(me.user.email, c.req.valid('param').id);
      if (!target) throw new DomainError('not_found', 'Order not found');
      // The manage-link token is the command's credential; it comes from the order's own envelope
      // and never reaches the client or the idempotency record's key.
      const r = await executeCommand(
        idempotent(requestRefundCommand),
        { manageToken: target.manageToken, ticketIds: input.ticketIds, message: input.message },
        orgCtx(me.ctx, target.orgId),
        ports,
      );
      return c.json(toWire(BuyerRefundRequest, r), 201);
    })
    .openapi(routes.getClaim, async (c) => {
      const claim = await claimContext(c.req.valid('param').token);
      if (!claim) throw new DomainError('not_found', 'This link is not valid');
      const details = await executeQuery(claimDetailsQuery, { claimId: claim.id }, claim.ctx, ports);
      const orgId = claim.ctx.orgId as string;
      const organizerName = await withTenant(
        createCtx({ orgId, actor: { type: 'system', name: 'me.claims' } }),
        (tx) => organizationNameTx(tx, orgId),
      );
      return cachedJson(
        c,
        toWire(ClaimDetails, { ...details, organizerName: organizerName ?? '' }),
        SENSITIVE_CACHE,
      );
    })
    .openapi(routes.claim, async (c) => {
      const me = c.get('me');
      const claim = await claimContext(c.req.valid('param').token);
      if (!claim) throw new DomainError('not_found', 'This link is not valid');
      const orgId = claim.ctx.orgId as string;
      const { ticketId } = await executeCommand(
        idempotent(claimTicketForPersonCommand),
        {
          claimId: claim.id,
          name: c.req.valid('json').name ?? (me.user.name || me.user.email),
          email: me.user.email,
        },
        orgCtx(me.ctx, orgId),
        ports,
      );
      const claimed = await personTicket(me.user.email, ticketId);
      // Replayed after the claimant passed the ticket on: it is no longer theirs to read.
      if (!claimed) throw new DomainError('not_found', 'Ticket not found');
      return c.json(detailWire(c, claimed), 200);
    });
}
