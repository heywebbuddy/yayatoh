import type { TenantTx } from '@yayatoh/db';
import { placedSeats } from '@yayatoh/floorplan';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validDoc } from './layouts.ts';
import { BLOCK_REASONS, eventLayouts, eventSeats } from './schema.ts';

/**
 * M1.4b duplicate / templates: an event's floor plan document with each seat's price category
 * (the source ticket type id, remapped on copy) and organizer blocks (channel, access, kill).
 * Never holds, sales or guest assignments: seats assigned to guests come back available.
 */
export const SeatingSnapshot = z
  .object({
    doc: z.unknown(),
    seats: z.array(
      z.object({
        seatUuid: z.string(),
        ticketTypeKey: z.string().nullable(),
        blockReason: z.enum(BLOCK_REASONS).nullable(),
      }),
    ),
  })
  .nullable();
export type SeatingSnapshot = z.infer<typeof SeatingSnapshot>;

const isBlock = (r: string | null): r is (typeof BLOCK_REASONS)[number] =>
  r !== null && (BLOCK_REASONS as readonly string[]).includes(r);

export async function seatingSnapshotTx(tx: TenantTx, eventId: string): Promise<SeatingSnapshot> {
  const [layout] = await tx.select().from(eventLayouts).where(eq(eventLayouts.eventId, eventId));
  if (!layout) return null;
  const seats = await tx
    .select({
      seatUuid: eventSeats.seatUuid,
      ticketTypeId: eventSeats.ticketTypeId,
      blockReason: eventSeats.blockReason,
    })
    .from(eventSeats)
    .where(eq(eventSeats.eventId, eventId));
  return {
    doc: layout.doc,
    seats: seats.map((s) => ({
      seatUuid: s.seatUuid,
      ticketTypeKey: s.ticketTypeId,
      blockReason: isBlock(s.blockReason) ? s.blockReason : null,
    })),
  };
}

/**
 * Give a new event the snapshot's floor plan as a draft (not on sale until the organizer
 * publishes it), with categories mapped through `ticketTypeIds` (source key → new id).
 */
export async function instantiateSeatingTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { eventId: string; snapshot: SeatingSnapshot; ticketTypeIds: ReadonlyMap<string, string> },
): Promise<number> {
  if (!input.snapshot) return 0;
  const orgId = requireOrg(ctx);
  const { doc, checksum } = validDoc(input.snapshot.doc);
  const kept = new Map(input.snapshot.seats.map((s) => [s.seatUuid, s]));
  const seats = placedSeats(doc);
  for (let i = 0; i < seats.length; i += 1000)
    await tx.insert(eventSeats).values(
      seats.slice(i, i + 1000).map((s) => {
        const k = kept.get(s.seatId);
        const ticketTypeId = k?.ticketTypeKey ? (input.ticketTypeIds.get(k.ticketTypeKey) ?? null) : null;
        return {
          orgId,
          eventId: input.eventId,
          seatUuid: s.seatId,
          label: s.label,
          itemId: s.itemId,
          sectionId: s.sectionId,
          accessible: s.accessible,
          ticketTypeId,
          status: k?.blockReason ? ('blocked' as const) : ('available' as const),
          blockReason: k?.blockReason ?? null,
        };
      }),
    );
  await tx.insert(eventLayouts).values({
    orgId,
    eventId: input.eventId,
    doc,
    checksum,
    seatCount: seats.length,
    status: 'draft',
  });
  return seats.length;
}
