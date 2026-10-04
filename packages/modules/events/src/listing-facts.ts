import type { TenantTx } from '@yayatoh/db';
import { eq } from 'drizzle-orm';
import type { AttendanceMode, EventCategory } from './domain/categories.ts';
import { events } from './schema.ts';

/**
 * M6.14a: what the marketplace's search index needs beyond `EventDto` — the platform category,
 * the attendance mode and the venue (for its public location). A narrow read in the caller's
 * tenant transaction; null when the event does not exist.
 */
export async function eventListingFactsTx(
  tx: TenantTx,
  eventId: string,
): Promise<{
  readonly category: EventCategory | null;
  readonly attendanceMode: AttendanceMode;
  readonly venueId: string | null;
} | null> {
  const [row] = await tx
    .select({ category: events.category, attendanceMode: events.attendanceMode, venueId: events.venueId })
    .from(events)
    .where(eq(events.id, eventId));
  if (!row) return null;
  return {
    category: (row.category as EventCategory | null) ?? null,
    attendanceMode: row.attendanceMode as AttendanceMode,
    venueId: row.venueId,
  };
}
