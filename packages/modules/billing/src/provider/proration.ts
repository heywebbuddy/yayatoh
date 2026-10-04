/**
 * Proration as the fake billing provider computes it (M6.6b): the same shape Stripe's invoice
 * preview returns, with deterministic arithmetic in integer minor units. The real provider does
 * its own math (and its own tax); the app only shows what the provider's preview says.
 */

/** The nonprofit coupon (P6-7; research: 20 % off the plan). Pending the owner. */
export const NONPROFIT_COUPON = { id: 'nonprofit', percentOff: 20 } as const;

/** The fake provider's tax setting: a flat 8 % stands in for Stripe Tax in dev and CI. */
export const FAKE_TAX_BPS = 800;

const DAY = 86_400_000;
const periodMs = (interval: 'month' | 'year') => (interval === 'year' ? 365 : 30) * DAY;

/** Round half away from zero to an integer number of minor units. */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

export interface ProrationPrice {
  readonly unitAmountMinor: number;
  readonly interval: 'month' | 'year';
  readonly currency: string;
}

export interface ProrationInput {
  /** The live subscription's price, or null when the org starts a subscription now. */
  readonly current: ProrationPrice | null;
  readonly target: ProrationPrice;
  /** End of the current period (null when starting). */
  readonly periodEnd: Date | null;
  readonly at: Date;
  readonly percentOff: number;
  readonly taxBps: number;
}

export interface ProrationResult {
  readonly currency: string;
  /** Unused time on the current price, credited (≥ 0). */
  readonly creditMinor: number;
  /** The remaining time on the new price (≥ 0). */
  readonly chargeMinor: number;
  /** The coupon's part of what is charged now (≥ 0). */
  readonly discountMinor: number;
  /** Tax on what is charged now (≥ 0). */
  readonly taxMinor: number;
  /** Charged today (≥ 0). */
  readonly amountDueMinor: number;
  /** A downgrade's leftover credit, kept for the next invoices (≥ 0). */
  readonly creditBalanceMinor: number;
  /** The next renewal at the new price, after the coupon and tax. */
  readonly nextRenewalMinor: number;
  /** When the next renewal is due. */
  readonly nextRenewalAt: Date;
}

const afterCoupon = (amount: number, percentOff: number) => amount - round((amount * percentOff) / 100);
const taxOn = (amount: number, bps: number) => (amount > 0 ? round((amount * bps) / 10_000) : 0);

/**
 * Prorate a plan change at `at`: credit the unused part of the current period at the current
 * price, charge the rest of the period at the new price. Starting a subscription charges a whole
 * period. The coupon applies to what is charged, tax to what is left; a net credit is kept on the
 * customer's balance (never paid out).
 */
export function prorate(i: ProrationInput): ProrationResult {
  if (i.current && i.current.currency !== i.target.currency)
    throw new Error('A plan change keeps the currency');
  const percentOff = Math.min(100, Math.max(0, i.percentOff));
  const renewal = afterCoupon(i.target.unitAmountMinor, percentOff);
  const nextRenewalMinor = renewal + taxOn(renewal, i.taxBps);
  if (!i.current || !i.periodEnd || i.periodEnd <= i.at) {
    const discountMinor = i.target.unitAmountMinor - renewal;
    const taxMinor = taxOn(renewal, i.taxBps);
    return {
      currency: i.target.currency,
      creditMinor: 0,
      chargeMinor: i.target.unitAmountMinor,
      discountMinor,
      taxMinor,
      amountDueMinor: renewal + taxMinor,
      creditBalanceMinor: 0,
      nextRenewalMinor,
      nextRenewalAt: new Date(i.at.getTime() + periodMs(i.target.interval)),
    };
  }
  const left = i.periodEnd.getTime() - i.at.getTime();
  const share = (p: ProrationPrice) => round(p.unitAmountMinor * Math.min(1, left / periodMs(p.interval)));
  const creditMinor = share(i.current);
  const chargeMinor = share(i.target);
  // The coupon applies to both sides of the proration (Stripe discounts proration items too).
  const net = afterCoupon(chargeMinor, percentOff) - afterCoupon(creditMinor, percentOff);
  const discountMinor = Math.max(0, chargeMinor - creditMinor - net);
  const taxMinor = taxOn(net, i.taxBps);
  return {
    currency: i.target.currency,
    creditMinor,
    chargeMinor,
    discountMinor,
    taxMinor,
    amountDueMinor: Math.max(0, net) + taxMinor,
    creditBalanceMinor: Math.max(0, -net),
    nextRenewalMinor,
    nextRenewalAt: i.periodEnd,
  };
}
