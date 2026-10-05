/**
 * Pure receipt rules (M4.8b; plan `docs/plans/phase-4.md` P4-11). Universal (no `node:*`): the
 * console and the public ticket page import them too.
 *
 * - A receipt is issued per payment (an order), never per pledge.
 * - Deductible amount = amount paid to the charity − fair-market value of what the payer got,
 *   never below zero. A pure gift has no fair-market value: "No goods or services were provided".
 * - Only a staff-verified charity profile, on an order paid to the charity's own connected
 *   account (`organizer_mor`, decision 2026-09-28), issues tax-deductible receipts; everything else
 *   gets a plain "This payment is not tax-deductible" receipt. US and USD only at first.
 * - The quid-pro-quo notice shows on ticket pages for payments over $75 (IRC §6115).
 */

export const CHARITY_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type CharityStatus = (typeof CHARITY_STATUSES)[number];

/** How the org is exempt: its own 501(c)(3) status, or a fiscal sponsor's (whose details print). */
export const EXEMPT_KINDS = ['501c3', 'fiscal_sponsor'] as const;
export type ExemptKind = (typeof EXEMPT_KINDS)[number];

export const RECEIPT_KINDS = ['gift', 'ticket'] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** Tax-deductible receipts are US-only at first: USD amounts (P4-11). */
export const RECEIPT_CURRENCY = 'USD';

/** IRC §6115: a payment of more than $75, partly a gift and partly for goods or services. */
export const QUID_PRO_QUO_THRESHOLD_MINOR = 7_500;

/** Hard cap on a fair-market value (a ticket type's): 1,000,000.00. */
export const FMV_MAX_MINOR = 100_000_000;

/** The EIN as printed: `12-3456789`. Accepts 9 digits with or without the hyphen or spaces. */
export function normalizeEin(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(digits)) return null;
  // The IRS never assigns these prefixes (00, 07–09, 17–19, 28–29, 49, 69, 70, 78–79, 89, 96–97).
  const prefix = Number(digits.slice(0, 2));
  if ([0, 7, 8, 9, 17, 18, 19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97].includes(prefix)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Deductible part of a payment: amount − fair-market value, never below zero. */
export function deductibleMinor(amountMinor: number, fmvMinor: number): number {
  if (!Number.isInteger(amountMinor) || !Number.isInteger(fmvMinor)) throw new Error('integer minor units');
  return Math.max(0, amountMinor - Math.max(0, fmvMinor));
}

/** One line of a ticket order as the receipt sees it. */
export interface ReceiptLine {
  readonly name: string;
  readonly quantity: number;
  /** What the payer paid per ticket to the charity: face price less discount (no platform fee). */
  readonly unitPaidMinor: number;
  /** The ticket type's fair-market value per ticket; null when none is set (all of it is value). */
  readonly unitFmvMinor: number | null;
  /** What the payer got (e.g. "Dinner and entertainment"); null when none was described. */
  readonly description: string | null;
}

export interface ReceiptAmounts {
  readonly amountMinor: number;
  readonly fmvMinor: number;
  readonly deductibleMinor: number;
  /** "2 × Gala dinner (Dinner and entertainment)" lines, or null for a pure gift. */
  readonly goods: string | null;
}

/**
 * A ticket order's receipt amounts. A line whose ticket type has no fair-market value counts at
 * its full price (nothing deductible from it): only a value the charity stated reduces the value
 * received. Fair-market value per line is capped at what was paid for it.
 */
export function ticketReceiptAmounts(lines: readonly ReceiptLine[]): ReceiptAmounts {
  let amount = 0;
  let fmv = 0;
  const goods: string[] = [];
  for (const l of lines) {
    const paid = l.unitPaidMinor * l.quantity;
    const value = l.unitFmvMinor === null ? paid : Math.min(paid, l.unitFmvMinor * l.quantity);
    amount += paid;
    fmv += value;
    goods.push(`${l.quantity} × ${l.name}${l.description ? ` (${l.description})` : ''}`);
  }
  return {
    amountMinor: amount,
    fmvMinor: fmv,
    deductibleMinor: deductibleMinor(amount, fmv),
    goods: goods.length > 0 ? goods.join('; ') : null,
  };
}

/** A gift: the whole charge (gift plus any fee cover, which also goes to the charity) is deductible. */
export function giftReceiptAmounts(chargedMinor: number): ReceiptAmounts {
  return { amountMinor: chargedMinor, fmvMinor: 0, deductibleMinor: chargedMinor, goods: null };
}

/** Whether a payment issues a tax-deductible receipt (else a plain "not tax-deductible" one). */
export function isDeductibleReceipt(input: {
  readonly charityStatus: CharityStatus | null;
  readonly fundsFlow: string;
  readonly currency: string;
}): boolean {
  return (
    input.charityStatus === 'verified' &&
    input.fundsFlow === 'organizer_mor' &&
    input.currency === RECEIPT_CURRENCY
  );
}

/**
 * The quid-pro-quo notice for one ticket type, if its page must show one: a verified charity, a
 * price over $75 in USD and a stated fair-market value. `null` otherwise.
 */
export function quidProQuoNotice(input: {
  readonly priceMinor: number;
  readonly fmvMinor: number | null;
  readonly currency: string;
}): { priceMinor: number; fmvMinor: number; deductibleMinor: number } | null {
  if (input.fmvMinor === null || input.currency !== RECEIPT_CURRENCY) return null;
  if (input.priceMinor <= QUID_PRO_QUO_THRESHOLD_MINOR) return null;
  return {
    priceMinor: input.priceMinor,
    fmvMinor: Math.min(input.fmvMinor, input.priceMinor),
    deductibleMinor: deductibleMinor(input.priceMinor, input.fmvMinor),
  };
}

/** The calendar year of an instant in a timezone (the org's: year-end statements, P4-11). */
export function taxYearOf(at: Date, timeZone: string): number {
  const y = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at);
  return Number(y);
}

/** The local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateOf(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Which tax year's statements are due on `now` in the org's timezone: the previous calendar year,
 * once January 1 has fully begun locally. Always the year before the local year.
 */
export function statementYearDue(now: Date, timeZone: string): number {
  return taxYearOf(now, timeZone) - 1;
}

export interface StatementLine {
  readonly amountMinor: number;
  readonly fmvMinor: number;
  readonly deductibleMinor: number;
}

/** A year-end statement's totals: exact sums of its receipts (integer minor units). */
export function statementTotals(lines: readonly StatementLine[]): StatementLine & { count: number } {
  let amount = 0;
  let fmv = 0;
  let deductible = 0;
  for (const l of lines) {
    amount += l.amountMinor;
    fmv += l.fmvMinor;
    deductible += l.deductibleMinor;
  }
  return { count: lines.length, amountMinor: amount, fmvMinor: fmv, deductibleMinor: deductible };
}

/** Receipt numbers per org: R-00001. */
export const formatReceiptNumber = (n: number) => `R-${String(n).padStart(5, '0')}`;
