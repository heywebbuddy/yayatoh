import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { ORDER_STATUSES } from './schema.ts';

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

export const PublicOrderDto = OrderDto.omit({ eventId: true }).extend({
  /** Who sold it (roadmap §4.4 seller disclosure): the organizer, or the platform on their behalf. */
  fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
  /** Organizer-collected (box office): the receipt says "Payment collected by {Org}". */
  collectedBy: z.enum(['platform', 'organizer']),
  tickets: z.array(HolderTicketDto),
  /** Tickets of this order now held by someone else (passed on with a claim link). */
  transferred: z.int(),
  event: HolderEventDto,
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
  /** Answers to the event's checkout questions (forms module), validated server-side. */
  answers: z.record(z.string().max(40), z.unknown()).default({}),
  locale: z.string().max(10).default('en'),
});
