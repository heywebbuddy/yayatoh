import { randomInt } from 'node:crypto';

/**
 * Credit notes (M3.10c): pure maths and formats. Amounts are integer minor units.
 *
 * What can still be credited on an order: what the buyer paid, less what was refunded (or is
 * being refunded) and what earlier credit notes already cover. Never negative.
 */
export function creditableMinor(o: {
  readonly totalMinor: number;
  readonly refundedMinor: number;
  readonly creditedMinor: number;
}): number {
  return Math.max(0, o.totalMinor - o.refundedMinor - o.creditedMinor);
}

export type CreditNoteProblem = 'nothing_to_credit' | 'amount_required' | 'amount_too_large';

/**
 * The amount of a new note: `full` is everything still creditable; `partial` is the amount asked
 * (1 … creditable).
 */
export function creditNoteAmount(
  kind: 'full' | 'partial',
  requestedMinor: number | null | undefined,
  creditable: number,
): { ok: true; amountMinor: number } | { ok: false; problem: CreditNoteProblem } {
  if (creditable <= 0) return { ok: false, problem: 'nothing_to_credit' };
  if (kind === 'full') return { ok: true, amountMinor: creditable };
  if (!requestedMinor || !Number.isInteger(requestedMinor) || requestedMinor < 1)
    return { ok: false, problem: 'amount_required' };
  if (requestedMinor > creditable) return { ok: false, problem: 'amount_too_large' };
  return { ok: true, amountMinor: requestedMinor };
}

/** Numbered per org, gap-free: CN-00001, CN-00002… (more digits once past 99,999). */
export const formatCreditNoteNumber = (n: number) => `CN-${String(n).padStart(5, '0')}`;

/** No 0/O, 1/I/L: read aloud and typed without mistakes. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^CR-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** A store credit code the buyer types at checkout: `CR-XXXX-XXXX` (about 40 bits). */
export function newCreditCode(rand: (max: number) => number = randomInt): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[rand(ALPHABET.length)]).join('');
  return `CR-${part()}-${part()}`;
}

/** Normalize what the buyer typed (case, spaces); null when it is not a credit code. */
export function parseCreditCode(input: string): string | null {
  const v = input.trim().toUpperCase().replace(/\s+/g, '');
  return CODE_RE.test(v) ? v : null;
}
