/**
 * Ticket transfer rules (M3.10c), per ticket type: whether holders may pass the ticket on, until
 * how many hours before the event, and for what fee (integer minor units). Organizers transfer
 * from the order page regardless of the holder rules and without a fee (a support action), but
 * never once the event has ended or for a ticket that is no longer valid.
 */
export interface TransferRules {
  readonly transfersAllowed: boolean;
  /** Holder transfers close this many hours before the start (null: at the start). */
  readonly transferCutoffHours: number | null;
  readonly transferFeeMinor: number;
}

export type TransferRefusal = 'ticket_void' | 'event_ended' | 'not_allowed' | 'deadline_passed';

export type TransferDecision =
  | { readonly ok: true; readonly feeMinor: number }
  | { readonly ok: false; readonly reason: TransferRefusal; readonly deadline?: Date };

const HOUR = 3_600_000;

/** The moment holder transfers close for this ticket type. */
export function transferDeadline(rules: TransferRules, startsAt: Date): Date {
  return new Date(startsAt.getTime() - (rules.transferCutoffHours ?? 0) * HOUR);
}

export function decideTransfer(
  rules: TransferRules,
  at: {
    readonly now: Date;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly ticketActive: boolean;
    readonly by: 'organizer' | 'holder';
  },
): TransferDecision {
  if (!at.ticketActive) return { ok: false, reason: 'ticket_void' };
  if (at.now >= at.endsAt) return { ok: false, reason: 'event_ended' };
  if (at.by === 'organizer') return { ok: true, feeMinor: 0 };
  if (!rules.transfersAllowed) return { ok: false, reason: 'not_allowed' };
  const deadline = transferDeadline(rules, at.startsAt);
  if (at.now >= deadline) return { ok: false, reason: 'deadline_passed', deadline };
  return { ok: true, feeMinor: rules.transferFeeMinor };
}
