import type { TenantTx } from '@yayatoh/db';
import { occurrencesOfEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tickets } from './schema.ts';

/**
 * M1.4b — ticket validity per date. A ticket type lists the occurrences it sells for (empty =
 * every date); a ticket bought for a date carries that `occurrence_id`. Access dates (multi-day
 * passes, M1.5) stay a separate rule on top: they name calendar days a pass admits.
 */

/** Every id must be a date of this event (any status: a cancelled one simply stops selling). */
export async function assertOccurrenceIdsTx(
  tx: TenantTx,
  eventId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const known = new Set((await occurrencesOfEventTx(tx, eventId)).map((o) => o.id));
  if (ids.some((id) => !known.has(id)))
    throw new DomainError('validation_failed', 'Choose dates of this event', {
      field: 'occurrenceIds',
      reason: 'unknown_occurrence',
    });
}

/** Whether a ticket type sells for a date. */
export const validForOccurrence = (type: { occurrenceIds: readonly string[] }, occurrenceId: string) =>
  type.occurrenceIds.length === 0 || type.occurrenceIds.includes(occurrenceId);

/** Live (not void) tickets bound to one date. */
export async function activeTicketsForOccurrenceTx(tx: TenantTx, occurrenceId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.occurrenceId, occurrenceId), eq(tickets.status, 'active')));
  return r?.n ?? 0;
}

export const OccurrenceSalesDto = z.array(z.object({ occurrenceId: z.uuid(), activeTickets: z.int() }));

/**
 * Live tickets per date of an event: the console's dates list and the "cancel this date" impact
 * message (refunds stay the organizer's decision).
 */
export const occurrenceSalesQuery = tenantQuery({
  name: 'ticketing.occurrenceSales',
  input: z.object({ eventId: z.uuid() }),
  output: OccurrenceSalesDto,
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    tx
      .select({
        occurrenceId: sql<string>`${tickets.occurrenceId}`,
        activeTickets: sql<number>`count(*)::int`,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.eventId, input.eventId),
          eq(tickets.status, 'active'),
          isNotNull(tickets.occurrenceId),
        ),
      )
      .groupBy(tickets.occurrenceId),
});
