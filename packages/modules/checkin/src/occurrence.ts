import type { RuleTicket } from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { findOccurrenceTx } from '@yayatoh/events';
import type { ScannableTicket } from '@yayatoh/ticketing';

/**
 * M1.4b: attach the date a ticket of a multi-date event admits, for the shared rules
 * (`wrong_date`). A ticket without a date (single-date events, guests, passes) admits every date.
 */
export async function withOccurrenceTx<T extends ScannableTicket>(
  tx: TenantTx,
  ticket: T | null,
): Promise<(T & Pick<RuleTicket, 'occurrence'>) | null> {
  if (!ticket) return null;
  if (!ticket.occurrenceId) return { ...ticket, occurrence: null };
  const occ = await findOccurrenceTx(tx, ticket.occurrenceId);
  return {
    ...ticket,
    occurrence: occ
      ? { startsAt: occ.startsAt, endsAt: occ.endsAt, status: occ.status }
      : { startsAt: new Date(0), endsAt: new Date(0), status: 'cancelled' },
  };
}
