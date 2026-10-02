import { defineSerializer } from '@yayatoh/contracts';
import { BuyerMessageDto } from '@yayatoh/notifications';
import { z } from 'zod';
import { ORDER_STATUSES, REFUND_POLICY_KINDS, REFUND_REQUEST_STATUSES } from './schema.ts';

export const OrderItemDto = z.object({
  ticketTypeId: z.uuid(),
  name: z.string(),
  quantity: z.int(),
  unitAllInMinor: z.int(),
});

export const OrderDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  buyerEmail: z.string(),
  buyerName: z.string(),
  currency: z.string(),
  subtotalMinor: z.int(),
  discountMinor: z.int(),
  promoCode: z.string().nullable(),
  feeMinor: z.int(),
  totalMinor: z.int(),
  expiresAt: z.date().nullable(),
  paidAt: z.date().nullable(),
  createdAt: z.date(),
  items: z.array(OrderItemDto),
});
export type OrderDto = z.infer<typeof OrderDto>;

/** Returned once to the buyer who started checkout: includes the manage token (never stored in clear). */
export const CheckoutResultDto = z.object({
  order: OrderDto,
  manageToken: z.string(),
  /** How to create the provider payment (server only; never sent to the browser). */
  payment: z.object({
    fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
    connectedAccountId: z.string().nullable(),
    applicationFeeMinor: z.int().nonnegative(),
  }),
});
export type CheckoutResultDto = z.infer<typeof CheckoutResultDto>;

/** A ticket as its holder sees it; `code` is the signed yy1 payload rendered as the QR. */
export const HolderTicketDto = z.object({
  id: z.uuid(),
  /** Seated events: "Row A · 5". */
  seatLabel: z.string().nullable(),
  ticketTypeId: z.uuid(),
  serial: z.int(),
  shortCode: z.string(),
  status: z.string(),
  holderName: z.string(),
  code: z.string(),
  /** Multi-date events (M1.4b): the date this ticket admits; null = every date of the event. */
  date: z.object({ startsAt: z.date(), endsAt: z.date() }).nullable(),
});

/** What a guest sees on the order page (reached by the manage token, which is the credential). */
/** The event as its ticket holder sees it (name, times in its timezone, place, organizer). */
export const HolderEventDto = z.object({
  name: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  organizerName: z.string(),
});

/** An event's refund policy as organizers and buyers see it (no internal fields). */
export const RefundPolicyDto = z.object({
  kind: z.enum(REFUND_POLICY_KINDS),
  daysBefore: z.int().nullable(),
  retainedMinor: z.int(),
  currency: z.string(),
  /** `until`: the last instant a discretionary refund is possible (the event's timezone decides the day). */
  deadline: z.date().nullable(),
  timezone: z.string(),
});
export type RefundPolicyDto = z.infer<typeof RefundPolicyDto>;

/** A buyer's refund request as the buyer sees it on the order page (no internal fields). */
export const BuyerRefundRequestDto = z.object({
  status: z.enum(REFUND_REQUEST_STATUSES),
  tickets: z.int(),
  createdAt: z.date(),
  decidedAt: z.date().nullable(),
  /** Declined: the organizer's reason, sent to the buyer. */
  declineReason: z.string().nullable(),
});
export type BuyerRefundRequestDto = z.infer<typeof BuyerRefundRequestDto>;

/** The refund-request panel of a buyer's order page: the latest request and whether they may ask now. */
export const BuyerRefundPanelDto = z.object({
  latest: BuyerRefundRequestDto.nullable(),
  canRequest: z.boolean(),
  /** Why not (when `canRequest` is false and there is a reason worth saying). */
  refusal: z.enum(['request_open', 'policy_no_refunds', 'policy_window_closed']).nullable(),
  deadline: z.date().nullable(),
});
export type BuyerRefundPanelDto = z.infer<typeof BuyerRefundPanelDto>;

/** M3.10c: a credit note as the buyer sees it on their order page. */
export const BuyerCreditNoteDto = z.object({
  label: z.string(),
  amountMinor: z.int(),
  balanceMinor: z.int(),
  currency: z.string(),
  disposition: z.enum(['store_credit', 'refunded']),
  reason: z.string(),
  /** Store credit: the code to use at checkout. */
  code: z.string().nullable(),
  createdAt: z.date(),
});

export const PublicOrderDto = OrderDto.omit({ eventId: true }).extend({
  /** Who sold it (roadmap §4.4 seller disclosure): the organizer, or the platform on their behalf. */
  fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
  /** Organizer-collected (box office): the receipt says "Payment collected by {Org}". */
  collectedBy: z.enum(['platform', 'organizer']),
  tickets: z.array(HolderTicketDto),
  /** Tickets of this order now held by someone else (passed on with a claim link). */
  transferred: z.int(),
  event: HolderEventDto,
  /** "Emails sent": messages to the buyer's address about this order (notifications log). */
  messages: z.array(BuyerMessageDto),
  /**
   * M1.6e: the event's refund policy as the buyer bought under it, or null when none is set.
   * M3.10b: the policy snapshotted at purchase, or the current one when it is as generous.
   */
  refundPolicy: RefundPolicyDto.nullable(),
  /** M3.10b: the buyer's latest refund request and whether they may ask for one now. */
  refundRequest: BuyerRefundPanelDto,
  /** M3.10c: credit notes on this order (store credit shows its code: the buyer's own). */
  creditNotes: z.array(BuyerCreditNoteDto).default([]),
});
export type PublicOrderDto = z.infer<typeof PublicOrderDto>;
export const publicOrderSerializer = defineSerializer('orders.publicOrder', PublicOrderDto);

export const StartCheckoutInput = z.object({
  eventId: z.uuid(),
  items: z
    .array(
      z.object({
        ticketTypeId: z.uuid(),
        quantity: z.int().min(1).max(100),
        /** Donation passes: the amount per ticket, in minor units. */
        amountMinor: z.int().min(0).max(100_000_000).optional(),
      }),
    )
    .max(20)
    .default([]),
  /** Seated events: the chosen seats (their ticket types come from the seat map). */
  seats: z.array(z.uuid()).max(50).default([]),
  /** Multi-date events (M1.4b): the chosen date; required when the event has dates. */
  occurrenceId: z.uuid().optional(),
  buyer: z.object({
    email: z.email().transform((e) => e.toLowerCase()),
    name: z.string().trim().min(1).max(120),
  }),
  /** An explicit, unticked-by-default checkbox; buying is never consent to marketing. */
  marketingOptIn: z.boolean().default(false),
  promoCode: z.string().trim().max(64).optional(),
  /**
   * M1.4d: the access code the visitor redeemed (its id, from their signed cookie). Re-checked
   * here: it may open a private event and hidden passes while it is active and unexpired.
   */
  accessCodeId: z.uuid().optional(),
  /**
   * M3.10a: the waitlist link of an open offer. The order buys the offer's held stock (its pass,
   * at most its quantity, its date, by its address) instead of taking new stock.
   */
  waitlistToken: z.string().min(10).max(200).optional(),
  /** Answers to the event's checkout questions (forms module), validated server-side. */
  answers: z.record(z.string().max(40), z.unknown()).default({}),
  locale: z.string().max(10).default('en'),
  /**
   * M1.6e: the pre-checkout risk rules that asked for a review (the server action assesses them
   * through the risk port before the order exists; a block never reaches this command).
   */
  riskReview: z
    .array(z.string().regex(/^[a-z_]{1,60}$/))
    .max(10)
    .default([]),
});
