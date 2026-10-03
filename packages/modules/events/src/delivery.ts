import type { TenantTx } from '@yayatoh/db';
import { eq } from 'drizzle-orm';
import type { ATTENDANCE_MODES } from './domain/categories.ts';
import { events } from './schema.ts';

/**
 * M6.9a: what the virtual module needs about an event, for organizers and ticket holders alike:
 * its status, visibility and delivery (attendance) mode, which stays the single source of truth.
 */
export interface EventDeliveryFacts {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly timezone: string;
  readonly attendanceMode: (typeof ATTENDANCE_MODES)[number];
}

export async function eventDeliveryTx(tx: TenantTx, eventId: string): Promise<EventDeliveryFacts | null> {
  const [row] = await tx
    .select({
      id: events.id,
      slug: events.slug,
      name: events.name,
      status: events.status,
      timezone: events.timezone,
      attendanceMode: events.attendanceMode,
    })
    .from(events)
    .where(eq(events.id, eventId));
  return row ? { ...row, attendanceMode: row.attendanceMode as EventDeliveryFacts['attendanceMode'] } : null;
}
