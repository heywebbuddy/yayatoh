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

/** What a guest sees on the order page. */
export const PublicOrderDto = OrderDto.omit({ eventId: true });
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
  locale: z.string().max(10).default('en'),
});
