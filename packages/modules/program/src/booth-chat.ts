import type { TenantTx } from '@yayatoh/db';
import { asc, eq } from 'drizzle-orm';
import { boothPlanTx } from './booths.ts';
import { unlistedExhibitorIdsTx } from './exhibitor-portal.ts';
import { exhibitors } from './schema.ts';

/** An exhibitor at one or more booths of an event, as booth chat (M5.8b) names it. */
export interface BoothExhibitor {
  readonly id: string;
  /** The approved public name (the same the exhibitor map shows). */
  readonly name: string;
  readonly boothNumbers: readonly string[];
  /** Listed on the public program and map (an unlisted exhibitor takes no booth chats). */
  readonly listed: boolean;
}

/**
 * Exhibitors of an event that stand at a booth, with their booth numbers, in name order (M5.8b:
 * attendees chat with them at their booth). Unlisted ones are included and flagged.
 */
export async function boothExhibitorsTx(tx: TenantTx, eventId: string): Promise<BoothExhibitor[]> {
  const plan = await boothPlanTx(tx, eventId);
  const numbers = new Map<string, string[]>();
  for (const b of plan.booths)
    for (const e of b.exhibitors)
      numbers.set(e.exhibitorId, [...(numbers.get(e.exhibitorId) ?? []), b.number]);
  if (numbers.size === 0) return [];
  const hidden = await unlistedExhibitorIdsTx(tx, eventId);
  const rows = await tx
    .select({ id: exhibitors.id, name: exhibitors.name })
    .from(exhibitors)
    .where(eq(exhibitors.eventId, eventId))
    .orderBy(asc(exhibitors.name), asc(exhibitors.createdAt));
  return rows
    .filter((r) => numbers.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      boothNumbers: numbers.get(r.id) ?? [],
      listed: !hidden.has(r.id),
    }));
}
