import type { TenantTx } from '@yayatoh/db';
import { asc, eq } from 'drizzle-orm';
import { currentFaceMinor } from './inventory.ts';
import { ticketTypes } from './schema.ts';

export interface TicketTypePrice {
  readonly id: string;
  readonly name: string;
  /** The face price buyers pay now (the early-bird price while it runs). */
  readonly priceMinor: number;
  readonly currency: string;
  /** Choose-your-amount: `priceMinor` is only the minimum. */
  readonly isDonation: boolean;
  readonly archived: boolean;
}

/**
 * An event's ticket types with the face price they sell at now (M4.8b: fair-market values and the
 * quid-pro-quo notice of the donations module), in display order. Archived ones too (flagged).
 */
export async function ticketTypePricesTx(
  tx: TenantTx,
  eventId: string,
  now: Date = new Date(),
): Promise<TicketTypePrice[]> {
  const rows = await tx
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId))
    .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceMinor: currentFaceMinor(r, now),
    currency: r.currency,
    isDonation: r.isDonation,
    archived: r.archivedAt !== null,
  }));
}
