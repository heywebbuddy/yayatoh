import { DomainError } from './errors.ts';

/**
 * Money in integer minor units (cents, fils, yen). Never floats, never strings in arithmetic.
 * Amounts must stay within Number.MAX_SAFE_INTEGER (~9e15 minor units).
 */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

/** ISO 4217 minor-unit exponents that differ from the default of 2. */
const EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

function assertCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new DomainError('validation_failed', `Invalid currency: ${currency}`);
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new DomainError('validation_failed', 'Money amount must be a safe integer in minor units');
  }
}

export function money(amount: number, currency: string): Money {
  assertAmount(amount);
  assertCurrency(currency);
  return Object.freeze({ amount, currency });
}

export function zero(currency: string): Money {
  return money(0, currency);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError('validation_failed', `Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function multiply(m: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new DomainError('validation_failed', 'Quantity must be an integer');
  return money(m.amount * quantity, m.currency);
}

export function isNegative(m: Money): boolean {
  return m.amount < 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

/** Round a rational n/d to an integer, halves to even (banker's rounding). d must be > 0. */
function divRoundHalfEven(n: number, d: number): number {
  const q = Math.floor(n / d);
  const r = n - q * d;
  const twice = 2 * r;
  if (twice < d) return q;
  if (twice > d) return q + 1;
  return q % 2 === 0 ? q : q + 1;
}

/**
 * A basis-point share of an amount (10_000 bps = 100%), rounded half-to-even.
 * Used for application fees and commissions; see roadmap §5.3.
 */
export function applyBps(m: Money, bps: number): Money {
  if (!Number.isInteger(bps)) throw new DomainError('validation_failed', 'bps must be an integer');
  return money(divRoundHalfEven(m.amount * bps, 10_000), m.currency);
}

/**
 * Split an amount by integer weights with the largest-remainder method.
 * The parts always sum exactly to the original amount.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new DomainError('validation_failed', 'allocate needs at least one weight');
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new DomainError('validation_failed', 'weights must be non-negative integers');
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) throw new DomainError('validation_failed', 'weights must not all be zero');

  const sign = m.amount < 0 ? -1 : 1;
  const abs = Math.abs(m.amount);
  const shares = weights.map((w) => Math.floor((abs * w) / total));
  let remainder = abs - shares.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, frac: (abs * w) % total }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder === 0) break;
    shares[i] = (shares[i] ?? 0) + 1;
    remainder -= 1;
  }
  return shares.map((s) => money(sign * s, m.currency));
}

export function formatMoney(m: Money, locale: string): string {
  const exp = currencyExponent(m.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(m.amount / 10 ** exp);
}
