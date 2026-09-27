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
});
export type CheckoutResultDto = z.infer<typeof CheckoutResultDto>;

/** A ticket as its holder sees it; `code` is the signed yy1 payload rendered as the QR. */
export const HolderTicketDto = z.object({
  id: z.uuid(),
  ticketTypeId: z.uuid(),
  serial: z.int(),
  shortCode: z.string(),
  status: z.string(),
  holderName: z.string(),
  code: z.string(),
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
  tickets: z.array(HolderTicketDto),
  event: HolderEventDto,
});
export type PublicOrderDto = z.infer<typeof PublicOrderDto>;
export const publicOrderSerializer = defineSerializer('orders.publicOrder', PublicOrderDto);

export const StartCheckoutInput = z.object({
  eventId: z.uuid(),
  items: z
    .array(z.object({ ticketTypeId: z.uuid(), quantity: z.int().min(1).max(100) }))
    .min(1)
    .max(20),
  buyer: z.object({
    email: z.email().transform((e) => e.toLowerCase()),
    name: z.string().trim().min(1).max(120),
  }),
  /** An explicit, unticked-by-default checkbox; buying is never consent to marketing. */
  marketingOptIn: z.boolean().default(false),
  promoCode: z.string().trim().max(64).optional(),
  locale: z.string().max(10).default('en'),
});
