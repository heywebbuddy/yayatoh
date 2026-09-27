import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { FEE_MODES, TICKET_TYPE_VISIBILITIES } from './schema.ts';

export const TicketTypeDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: z.int(),
  currency: z.string(),
  feeMode: z.enum(FEE_MODES),
  quantityTotal: z.int(),
  quantitySold: z.int(),
  quantityHeld: z.int(),
  minPerOrder: z.int(),
  maxPerOrder: z.int(),
  salesStartAt: z.date().nullable(),
  salesEndAt: z.date().nullable(),
  visibility: z.enum(TICKET_TYPE_VISIBILITIES),
  sortOrder: z.int(),
  archivedAt: z.date().nullable(),
  /** Per-ticket price the buyer sees (face + passed-on fees). */
  allInMinor: z.int(),
  feeMinor: z.int(),
});
export type TicketTypeDto = z.infer<typeof TicketTypeDto>;

export const PUBLIC_AVAILABILITY = ['available', 'sold_out', 'not_yet_on_sale', 'sales_ended'] as const;

/** Public passes: no inventory counts beyond "few left", no internals. */
export const PublicTicketTypeDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  currency: z.string(),
  allInMinor: z.int(),
  availability: z.enum(PUBLIC_AVAILABILITY),
  fewLeft: z.boolean(),
  minPerOrder: z.int(),
  maxPerOrder: z.int(),
});
export type PublicTicketTypeDto = z.infer<typeof PublicTicketTypeDto>;
export const publicTicketTypeSerializer = defineSerializer('ticketing.publicTicketType', PublicTicketTypeDto);

const Fields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  priceMinor: z.int().min(0).max(100_000_000),
  feeMode: z.enum(FEE_MODES).default('pass_on'),
  quantityTotal: z.int().min(0).max(1_000_000),
  minPerOrder: z.int().min(1).max(100).default(1),
  maxPerOrder: z.int().min(1).max(100).default(10),
  salesStartAt: z.coerce.date().nullable().default(null),
  salesEndAt: z.coerce.date().nullable().default(null),
  visibility: z.enum(TICKET_TYPE_VISIBILITIES).default('public'),
  sortOrder: z.int().default(0),
});

const orderedWindow = (v: { salesStartAt?: Date | null; salesEndAt?: Date | null }) =>
  !v.salesStartAt || !v.salesEndAt || v.salesEndAt > v.salesStartAt;
const orderedLimits = (v: { minPerOrder?: number; maxPerOrder?: number }) =>
  v.minPerOrder === undefined || v.maxPerOrder === undefined || v.maxPerOrder >= v.minPerOrder;

export const CreateTicketTypeInput = Fields.extend({ eventId: z.uuid() })
  .refine(orderedWindow, { message: 'salesEndAt must be after salesStartAt', path: ['salesEndAt'] })
  .refine(orderedLimits, { message: 'maxPerOrder must be ≥ minPerOrder', path: ['maxPerOrder'] });

export const UpdateTicketTypeInput = Fields.partial()
  .extend({ ticketTypeId: z.uuid() })
  .refine(orderedWindow, { message: 'salesEndAt must be after salesStartAt', path: ['salesEndAt'] })
  .refine(orderedLimits, { message: 'maxPerOrder must be ≥ minPerOrder', path: ['maxPerOrder'] });
