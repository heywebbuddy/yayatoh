import { withoutTenant } from '@yayatoh/db';
import { money } from '@yayatoh/kernel';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_PLAN } from './entitlements.ts';
import { type FeeSchedule, type PriceBreakdown, priceBreakdown } from './fees.ts';
import { feeSchedules } from './schema.ts';

/** What the public pricing page may show about a fee schedule (allowlist). */
export const PublicFeeDto = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  percentBps: z.int().min(0),
  fixedMinor: z.int().min(0),
});
export type PublicFee = z.infer<typeof PublicFeeDto>;

/**
 * The platform fee a new organizer pays (M3.11a pricing page): the default plan's schedule in
 * every configured currency, read from `billing.fee_schedules` (never hard-coded). Negotiated
 * per-org overrides are private and never shown here.
 */
export async function publicFeeSchedules(): Promise<PublicFee[]> {
  const rows = await withoutTenant((tx) =>
    tx
      .select({
        currency: feeSchedules.currency,
        percentBps: feeSchedules.percentBps,
        fixedMinor: feeSchedules.fixedMinor,
      })
      .from(feeSchedules)
      .where(eq(feeSchedules.planKey, DEFAULT_PLAN))
      .orderBy(asc(feeSchedules.currency)),
  );
  return z.array(PublicFeeDto).parse(rows);
}

/** Euro-area countries (ISO 3166-1 alpha-2). */
const EURO_COUNTRIES = new Set('AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' '));

/** The currency a country's buyers usually pay in, when it is one we know. */
export function countryCurrency(country: string | null | undefined): string | null {
  const c = country?.trim().toUpperCase() ?? '';
  if (c === 'US') return 'USD';
  if (c === 'CA') return 'CAD';
  if (c === 'GB') return 'GBP';
  if (EURO_COUNTRIES.has(c)) return 'EUR';
  return null;
}

/**
 * The currency the pricing page shows: the one the visitor picked, else their country's, else
 * USD, else the first configured, each only when a fee schedule exists for it. Null when no
 * currency is configured at all.
 */
export function pricingCurrency(
  configured: readonly string[],
  opts: { requested?: string | null; country?: string | null },
): string | null {
  const has = (c: string | null | undefined): c is string => !!c && configured.includes(c);
  const requested = opts.requested?.trim().toUpperCase();
  if (has(requested)) return requested;
  const local = countryCurrency(opts.country);
  if (has(local)) return local;
  if (has('USD')) return 'USD';
  return configured[0] ?? null;
}

/** A worked example for the pricing page: one ticket at `faceMinor`, fee passed on or absorbed. */
export function pricingExample(
  fee: FeeSchedule & { currency: string },
  faceMinor: number,
): { passOn: PriceBreakdown; absorb: PriceBreakdown } {
  const face = money(faceMinor, fee.currency);
  return { passOn: priceBreakdown(face, fee, 'pass_on'), absorb: priceBreakdown(face, fee, 'absorb') };
}
