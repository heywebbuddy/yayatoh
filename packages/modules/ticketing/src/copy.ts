import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { FEE_MODES, TICKET_TYPE_VISIBILITIES, ticketTypes } from './schema.ts';

const DAY_MS = 86_400_000;

/**
 * M1.4b duplicate / templates: an event's live ticket types without anything sold. Instants are
 * kept relative to the event's start (so a copy on another date keeps its sales windows and
 * early-bird), access days as day offsets. `key` is the source id (seat categories point at it).
 */
export const TicketTypesSnapshot = z.array(
  z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    priceMinor: z.int(),
    feeMode: z.enum(FEE_MODES),
    quantityTotal: z.int(),
    minPerOrder: z.int(),
    maxPerOrder: z.int(),
    visibility: z.enum(TICKET_TYPE_VISIBILITIES),
    sortOrder: z.int(),
    isDonation: z.boolean(),
    earlyPriceMinor: z.int().nullable(),
    earlyEndsOffsetMs: z.number().nullable(),
    salesStartOffsetMs: z.number().nullable(),
    salesEndOffsetMs: z.number().nullable(),
    accessDays: z.array(z.object({ dayOffset: z.int(), name: z.string() })),
  }),
);
export type TicketTypesSnapshot = z.infer<typeof TicketTypesSnapshot>;

const offset = (d: Date | null, anchor: Date) => (d ? d.getTime() - anchor.getTime() : null);
const at = (ms: number | null, anchor: Date) => (ms === null ? null : new Date(anchor.getTime() + ms));
const civilDay = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** `anchorDay` is the event's first local day (`YYYY-MM-DD`), for access-day offsets. */
export async function ticketTypesSnapshotTx(
  tx: TenantTx,
  eventId: string,
  anchor: Date,
  anchorDay: string,
): Promise<TicketTypesSnapshot> {
  const rows = await tx
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.eventId, eventId), isNull(ticketTypes.archivedAt)))
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
  return rows.map((r) => ({
    key: r.id,
    name: r.name,
    description: r.description,
    priceMinor: r.priceMinor,
    feeMode: r.feeMode as (typeof FEE_MODES)[number],
    quantityTotal: r.quantityTotal,
    minPerOrder: r.minPerOrder,
    maxPerOrder: r.maxPerOrder,
    visibility: r.visibility as (typeof TICKET_TYPE_VISIBILITIES)[number],
    sortOrder: r.sortOrder,
    isDonation: r.isDonation,
    earlyPriceMinor: r.earlyPriceMinor,
    earlyEndsOffsetMs: offset(r.earlyEndsAt, anchor),
    salesStartOffsetMs: offset(r.salesStartAt, anchor),
    salesEndOffsetMs: offset(r.salesEndAt, anchor),
    accessDays: r.accessDates.map((d) => ({
      dayOffset: Math.round((civilDay(d.date) - civilDay(anchorDay)) / DAY_MS),
      name: d.name,
    })),
  }));
}

/**
 * Create the snapshot's ticket types on a new event (nothing sold, every date). Returns source
 * key → new ticket type id.
 */
export async function instantiateTicketTypesTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    eventId: string;
    currency: string;
    anchor: Date;
    anchorDay: string;
    snapshot: TicketTypesSnapshot;
  },
): Promise<Map<string, string>> {
  const orgId = requireOrg(ctx);
  const map = new Map<string, string>();
  for (const t of input.snapshot) {
    const earlyEndsAt = at(t.earlyEndsOffsetMs, input.anchor);
    const [row] = await tx
      .insert(ticketTypes)
      .values({
        orgId,
        eventId: input.eventId,
        currency: input.currency,
        name: t.name,
        description: t.description,
        priceMinor: t.priceMinor,
        feeMode: t.feeMode,
        quantityTotal: t.quantityTotal,
        minPerOrder: t.minPerOrder,
        maxPerOrder: t.maxPerOrder,
        visibility: t.visibility,
        sortOrder: t.sortOrder,
        isDonation: t.isDonation,
        earlyPriceMinor: earlyEndsAt ? t.earlyPriceMinor : null,
        earlyEndsAt: t.earlyPriceMinor === null ? null : earlyEndsAt,
        salesStartAt: at(t.salesStartOffsetMs, input.anchor),
        salesEndAt: at(t.salesEndOffsetMs, input.anchor),
        accessDates: t.accessDays.map((d) => ({
          date: new Date(civilDay(input.anchorDay) + d.dayOffset * DAY_MS).toISOString().slice(0, 10),
          name: d.name,
        })),
      })
      .returning({ id: ticketTypes.id });
    if (!row) throw new DomainError('internal');
    map.set(t.key, row.id);
  }
  return map;
}
