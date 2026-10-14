import { z } from '@hono/zod-openapi';
import { REFUND_POLICY_KINDS, REFUND_REQUEST_STATUSES } from '@yayatoh/orders';
import { WALLET_PLATFORMS } from '@yayatoh/ticketing';
import { EventStatus, OrderStatus, pageSchema } from '../resources.ts';

/**
 * The wire resources of `/v1/me/…` (M7.2b): a signed-in person's own tickets and orders. Each is an
 * allowlist (`toWire` drops every key not declared), so an ORM row or a module DTO can never leak
 * through. Money is in minor units; instants are ISO strings and every event carries its time zone.
 */
const DateTime = z.iso.datetime({ offset: true });

export const MyTicketStatus = z.enum(['active', 'void']).openapi('MyTicketStatus', {
  description: 'A voided ticket (refunded or cancelled) admits nobody and has no code.',
});
export const TransferRefusal = z
  .enum(['ticket_void', 'event_ended', 'not_allowed', 'deadline_passed'])
  .openapi('TransferRefusal');
export const WalletPlatform = z.enum(WALLET_PLATFORMS).openapi('WalletPlatform');
export const CheckpointKind = z.enum(['entrance', 'zone']).openapi('TicketCheckpointKind');
export const RefundPolicyKind = z.enum(REFUND_POLICY_KINDS).openapi('RefundPolicyKind');
export const RefundRequestStatus = z.enum(REFUND_REQUEST_STATUSES).openapi('RefundRequestStatus');
export const RefundRefusal = z
  .enum(['request_open', 'policy_no_refunds', 'policy_window_closed'])
  .openapi('RefundRefusal');
export const ClaimState = z.enum(['open', 'claimed', 'revoked', 'expired']).openapi('ClaimState');
export const TransferOutcome = z.enum(['started', 'web_payment_required']).openapi('TransferOutcome');

const Dates = z.object({ startsAt: DateTime, endsAt: DateTime });

export const MyTicketEvent = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    status: EventStatus,
    startsAt: DateTime,
    endsAt: DateTime,
    timezone: z.string().openapi({ description: 'IANA time zone of the event; show times in it.' }),
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
  })
  .openapi('MyTicketEvent');

const summaryFields = {
  id: z.uuid(),
  orderId: z.uuid(),
  status: MyTicketStatus,
  rev: z.int().openapi({
    description:
      'The code revision. A transfer or re-send bumps it; the door refuses older codes as superseded.',
  }),
  shortCode: z.string(),
  serial: z.int(),
  holderName: z.string(),
  ticketTypeName: z.string(),
  seatLabel: z.string().nullable(),
  date: Dates.nullable().openapi({
    description: 'Multi-date events: the date this ticket admits. Null: the whole event.',
  }),
  event: MyTicketEvent,
  organizerName: z.string(),
  accentColor: z.string().nullable().openapi({
    description: 'The event’s own accent (#rrggbb), else the organizer’s. Null: use the app’s.',
  }),
  pendingTransfer: z.boolean().openapi({
    description: 'A transfer of this ticket is waiting for its recipient to claim it.',
  }),
};

export const MyTicketSummary = z.object(summaryFields).openapi('MyTicketSummary');
export const MyTicketPage = pageSchema(MyTicketSummary, 'MyTicketPage');

export const TicketTransferOptions = z
  .object({
    allowed: z.boolean(),
    reason: TransferRefusal.nullable(),
    deadline: DateTime.openapi({ description: 'When holder transfers close for this ticket.' }),
    feeMinor: z.int().openapi({ description: 'The ticket type’s transfer fee in minor units (0: free).' }),
    currency: z.string(),
    feeRequiresWeb: z.boolean().openapi({
      description: 'A fee is paid on the web: `POST …/transfers` answers with a link instead of starting it.',
    }),
    pendingTransferId: z.uuid().nullable(),
    pendingTransferTo: z.string().nullable().openapi({ description: 'The recipient’s name.' }),
  })
  .openapi('TicketTransferOptions');

export const TicketBranding = z
  .object({
    organizerName: z.string(),
    logoUrl: z.string().nullable().openapi({ description: 'Absolute URL of the organizer’s logo.' }),
    logoAlt: z.string().nullable(),
    accentColor: z.string().nullable(),
    poweredByVisible: z.boolean(),
  })
  .openapi('TicketBranding');

export const TicketCheckpoint = z
  .object({ name: z.string(), kind: CheckpointKind })
  .openapi('TicketCheckpoint');

export const TicketVenue = z
  .object({
    name: z.string(),
    addressLine1: z.string().nullable(),
    addressLine2: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    mapUrl: z.string().nullable(),
    accessibilityNotes: z.string().nullable(),
  })
  .openapi('TicketVenue');

export const MyTicket = z
  .object({
    ...summaryFields,
    qrCode: z.string().nullable().openapi({
      description:
        'The signed code to draw as a QR. Null for a voided ticket. Re-read it when `rev` changes.',
    }),
    ticketTypeId: z.uuid(),
    checkpoints: z.array(TicketCheckpoint).openapi({
      description: 'The entrances and zones where this ticket is checked.',
    }),
    venue: TicketVenue.nullable(),
    branding: TicketBranding,
    transfer: TicketTransferOptions,
  })
  .openapi('MyTicket');

export const TransferTicketRequest = z
  .object({
    toName: z.string().trim().min(1).max(120).openapi({ example: 'Sam Rivera' }),
    toEmail: z.email().max(254).openapi({ example: 'sam@example.com' }),
  })
  .openapi('TransferTicketRequest');

export const TicketTransferResult = z
  .object({
    status: TransferOutcome,
    transferId: z.uuid().nullable(),
    feeMinor: z.int(),
    currency: z.string(),
    webUrl: z.string().nullable().openapi({
      description: '`web_payment_required`: where to agree to the fee and pay it. Null otherwise.',
    }),
  })
  .openapi('TicketTransferResult', {
    description:
      '`started`: the recipient is emailed a claim link and the ticket stays yours until they claim it. `web_payment_required`: the ticket type charges a transfer fee, which is paid on the web; nothing was changed.',
  });

export const WalletPassLink = z
  .object({ platform: WalletPlatform, url: z.string(), serial: z.string() })
  .openapi('WalletPassLink');

/* ----------------------------------------------------------------------------- orders ---- */

export const MyOrderSummary = z
  .object({
    id: z.uuid(),
    organizerName: z.string(),
    eventId: z.uuid(),
    eventName: z.string(),
    startsAt: DateTime,
    endsAt: DateTime,
    timezone: z.string(),
    status: OrderStatus,
    tickets: z.int(),
    totalMinor: z.int(),
    currency: z.string(),
    createdAt: DateTime,
  })
  .openapi('MyOrderSummary');
export const MyOrderPage = pageSchema(MyOrderSummary, 'MyOrderPage');

export const MyOrderLine = z
  .object({
    ticketTypeId: z.uuid(),
    name: z.string(),
    quantity: z.int(),
    unitAllInMinor: z.int(),
  })
  .openapi('MyOrderLine');

export const MyRefundPolicy = z
  .object({
    kind: RefundPolicyKind,
    daysBefore: z.int().nullable(),
    retainedMinor: z.int(),
    currency: z.string(),
    deadline: DateTime.nullable(),
    timezone: z.string(),
  })
  .openapi('MyRefundPolicy');

export const BuyerRefundRequest = z
  .object({
    status: RefundRequestStatus,
    tickets: z.int(),
    createdAt: DateTime,
    decidedAt: DateTime.nullable(),
    declineReason: z.string().nullable(),
  })
  .openapi('BuyerRefundRequest');

export const BuyerRefundPanel = z
  .object({
    latest: BuyerRefundRequest.nullable(),
    canRequest: z.boolean(),
    refusal: RefundRefusal.nullable(),
    deadline: DateTime.nullable(),
  })
  .openapi('BuyerRefundPanel');

export const MyOrder = z
  .object({
    id: z.uuid(),
    organizerName: z.string(),
    event: z.object({
      slug: z.string(),
      name: z.string(),
      startsAt: DateTime,
      endsAt: DateTime,
      timezone: z.string(),
    }),
    eventId: z.uuid(),
    status: OrderStatus,
    currency: z.string(),
    subtotalMinor: z.int(),
    discountMinor: z.int(),
    feeMinor: z.int(),
    totalMinor: z.int(),
    paidAt: DateTime.nullable(),
    createdAt: DateTime,
    items: z.array(MyOrderLine),
    refundPolicy: MyRefundPolicy.nullable(),
    refundRequest: BuyerRefundPanel,
    ticketIds: z.array(z.uuid()).openapi({ description: 'The order’s active tickets you still hold.' }),
    transferred: z.int().openapi({ description: 'Tickets of this order now held by someone else.' }),
  })
  .openapi('MyOrder');

export const RefundRequestInput = z
  .object({
    ticketIds: z.array(z.uuid()).max(500).default([]).openapi({
      description: 'The tickets you hold to refund. Empty: all of them.',
    }),
    message: z.string().trim().max(1000).optional(),
  })
  .openapi('BuyerRefundRequestInput');

/* ----------------------------------------------------------------------------- claims ---- */

export const ClaimDetails = z
  .object({
    state: ClaimState,
    event: z.object({
      name: z.string(),
      startsAt: DateTime,
      endsAt: DateTime,
      timezone: z.string(),
    }),
    ticketTypeName: z.string(),
    organizerName: z.string(),
    transfer: z.object({ fromName: z.string(), toName: z.string() }).nullable().openapi({
      description: 'A transfer’s link names who sent it and who it is for; null for a plain claim link.',
    }),
  })
  .openapi('ClaimDetails');

export const ClaimRequest = z
  .object({
    name: z.string().trim().min(1).max(120).optional().openapi({
      description: 'The name on the ticket. Default: the signed-in account’s name.',
    }),
  })
  .openapi('ClaimRequest');
