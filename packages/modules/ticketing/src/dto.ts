import { defineSerializer, partialNoDefaults } from '@yayatoh/contracts';
import { z } from 'zod';
import { FEE_MODES, TICKET_TYPE_MANAGERS, TICKET_TYPE_VISIBILITIES } from './schema.ts';

/** Days a multi-day pass admits: unique ISO dates, sorted, each with a short name. */
export const AccessDates = z
  .array(z.object({ date: z.iso.date(), name: z.string().trim().min(1).max(60) }))
  .max(31)
  .refine((a) => new Set(a.map((d) => d.date)).size === a.length, 'Each date may appear once')
  .transform((a) => [...a].sort((x, y) => (x.date < y.date ? -1 : 1)));

const AccessDateDto = z.object({ date: z.string(), name: z.string() });

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
  earlyPriceMinor: z.int().nullable(),
  earlyEndsAt: z.date().nullable(),
  isDonation: z.boolean(),
  accessDates: z.array(AccessDateDto),
  /** Multi-date events: the dates this type sells for; empty = every date. */
  occurrenceIds: z.array(z.uuid()),
  /** M3.10c transfer rules: holders may transfer, until N hours before the start, for a fee. */
  transfersAllowed: z.boolean(),
  transferCutoffHours: z.int().nullable(),
  transferFeeMinor: z.int(),
  /** Per-ticket price the buyer sees now (face + passed-on fees; early-bird while it runs). */
  allInMinor: z.int(),
  feeMinor: z.int(),
  /** M5.1a: set when another module (registration) sells this pass; edit it there. */
  managedBy: z.enum(TICKET_TYPE_MANAGERS).nullable(),
  /** M4.2b: seats per table for a table ticket ("Table of 10"); null = an ordinary pass. */
  tableSize: z.int().nullable(),
});
export type TicketTypeDto = z.infer<typeof TicketTypeDto>;

export const PUBLIC_AVAILABILITY = ['available', 'sold_out', 'not_yet_on_sale', 'sales_ended'] as const;

/** Public passes: no inventory counts beyond "few left", no internals. */
export const PublicTicketTypeDto = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  currency: z.string(),
  /** All-in price now; for a donation pass, the minimum. */
  allInMinor: z.int(),
  /** Set while an early-bird price runs: the all-in price after it ends. */
  regularAllInMinor: z.int().nullable(),
  earlyEndsAt: z.date().nullable(),
  isDonation: z.boolean(),
  accessDates: z.array(AccessDateDto),
  /** Multi-date events: the dates this pass is for; empty = every date. */
  occurrenceIds: z.array(z.uuid()),
  availability: z.enum(PUBLIC_AVAILABILITY),
  fewLeft: z.boolean(),
  minPerOrder: z.int(),
  maxPerOrder: z.int(),
  /** M1.4d: a hidden pass shown because the visitor's access code unlocked it. */
  unlocked: z.boolean(),
  /** M4.2b: a table ticket: one unit seats this many guests; null = an ordinary pass. */
  tableSize: z.int().nullable(),
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
  earlyPriceMinor: z.int().min(0).max(100_000_000).nullable().default(null),
  earlyEndsAt: z.coerce.date().nullable().default(null),
  isDonation: z.boolean().default(false),
  accessDates: AccessDates.default([]),
  occurrenceIds: z
    .array(z.uuid())
    .max(366)
    .default([])
    .transform((a) => [...new Set(a)]),
  /** M3.10c transfer rules (organizers always transfer, for free). */
  transfersAllowed: z.boolean().default(true),
  transferCutoffHours: z.int().min(0).max(8760).nullable().default(null),
  transferFeeMinor: z.int().min(0).max(100_000_000).default(0),
});

/** Early-bird and donation rules on the merged ticket type (create input, or current row + update). */
export function pricingProblem(v: {
  priceMinor: number;
  earlyPriceMinor: number | null;
  earlyEndsAt: Date | null;
  isDonation: boolean;
}): { field: string; message: string } | null {
  if ((v.earlyPriceMinor === null) !== (v.earlyEndsAt === null))
    return { field: 'earlyEndsAt', message: 'An early-bird price needs an end date, and the reverse' };
  if (v.earlyPriceMinor !== null && v.earlyPriceMinor >= v.priceMinor)
    return { field: 'earlyPriceMinor', message: 'The early-bird price must be below the regular price' };
  if (v.isDonation && v.earlyPriceMinor !== null)
    return { field: 'isDonation', message: 'A donation pass has no early-bird price' };
  return null;
}

const orderedWindow = (v: { salesStartAt?: Date | null; salesEndAt?: Date | null }) =>
  !v.salesStartAt || !v.salesEndAt || v.salesEndAt > v.salesStartAt;
const orderedLimits = (v: { minPerOrder?: number; maxPerOrder?: number }) =>
  v.minPerOrder === undefined || v.maxPerOrder === undefined || v.maxPerOrder >= v.minPerOrder;

/** M4.2b: seats per table (a table ticket); fixed once created, since sold tables keep their slots. */
export const TABLE_SIZE = { min: 2, max: 20 } as const;

export const CreateTicketTypeInput = Fields.extend({
  eventId: z.uuid(),
  tableSize: z.int().min(TABLE_SIZE.min).max(TABLE_SIZE.max).nullable().default(null),
})
  .refine(orderedWindow, { message: 'salesEndAt must be after salesStartAt', path: ['salesEndAt'] })
  .refine(orderedLimits, { message: 'maxPerOrder must be ≥ minPerOrder', path: ['maxPerOrder'] })
  .superRefine((v, c) => {
    const p = pricingProblem(v);
    if (p) c.addIssue({ code: 'custom', message: p.message, path: [p.field] });
    if (v.tableSize !== null && v.isDonation)
      c.addIssue({ code: 'custom', message: 'A table ticket has a fixed price', path: ['tableSize'] });
  });

export const UpdateTicketTypeInput = partialNoDefaults(Fields)
  .extend({ ticketTypeId: z.uuid() })
  .refine(orderedWindow, { message: 'salesEndAt must be after salesStartAt', path: ['salesEndAt'] })
  .refine(orderedLimits, { message: 'maxPerOrder must be ≥ minPerOrder', path: ['maxPerOrder'] });

export type CreateTicketTypeInput = z.infer<typeof CreateTicketTypeInput>;
export type UpdateTicketTypeInput = z.infer<typeof UpdateTicketTypeInput>;
