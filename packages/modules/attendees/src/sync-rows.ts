import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { attendees } from './schema.ts';

/**
 * Attendee rows for a two-way sync (M6.4b: Google Sheets). Keyset over `(updated_at, id)` so a
 * sync reads every change once; internal fields only (the integrations engine maps and hashes
 * them, and only the mapped columns leave Yayatoh).
 */
export interface AttendeeSyncRow {
  readonly id: string;
  readonly eventId: string;
  readonly name: string;
  readonly email: string;
  readonly status: string;
  readonly source: string;
  readonly ticketId: string | null;
  readonly labels: readonly string[];
  readonly updatedAt: Date;
}

const columns = {
  id: attendees.id,
  eventId: attendees.eventId,
  name: attendees.name,
  email: attendees.email,
  status: attendees.status,
  source: attendees.source,
  ticketId: attendees.ticketId,
  labels: attendees.labels,
  updatedAt: attendees.updatedAt,
};

// Compared at millisecond precision (what a JS Date carries), so a cursor never re-reads its row.
const changedAt = sql`date_trunc('milliseconds', ${attendees.updatedAt})`;

const cursorOf = (r: AttendeeSyncRow) => `${r.updatedAt.toISOString()}|${r.id}`;

/** The attendees of these events changed after `cursor` (null: all), oldest change first. */
export async function attendeesChangedSinceTx(
  tx: TenantTx,
  eventIds: readonly string[],
  cursor: string | null,
  limit: number,
): Promise<(AttendeeSyncRow & { readonly cursor: string })[]> {
  if (eventIds.length === 0) return [];
  const m = cursor ? /^(.+)\|([0-9a-f-]{36})$/.exec(cursor) : null;
  const after = m?.[1] && m[2] ? { at: new Date(m[1]), id: m[2] } : null;
  const rows = await tx
    .select(columns)
    .from(attendees)
    .where(
      and(
        inArray(attendees.eventId, [...eventIds]),
        after && !Number.isNaN(after.at.getTime())
          ? or(
              sql`${changedAt} > ${after.at.toISOString()}::timestamptz`,
              and(
                sql`${changedAt} = ${after.at.toISOString()}::timestamptz`,
                sql`${attendees.id} > ${after.id}::uuid`,
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(changedAt), asc(attendees.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, cursor: cursorOf(r) }));
}

/** One attendee's sync row (null when it is gone). */
export async function attendeeSyncRowTx(tx: TenantTx, id: string): Promise<AttendeeSyncRow | null> {
  const [row] = await tx.select(columns).from(attendees).where(eq(attendees.id, id));
  return row ?? null;
}
