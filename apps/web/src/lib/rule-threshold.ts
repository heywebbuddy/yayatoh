import { currencyDigits, isRuleMoney, RULE_MEASURES, type RuleMeasure } from '@yayatoh/analytics';

/**
 * An alert rule's threshold as typed (M6.2b) → what the command takes: a whole count or
 * percentage, or an amount in major units ("12.50", "12,5") turned into integer minor units with
 * the currency's own decimals (never through floating point). Null when it is not a valid number.
 */
export function parseThreshold(
  raw: string,
  measure: string,
  condition: string,
  currency: string,
): number | null {
  const money = (RULE_MEASURES as readonly string[]).includes(measure) && isRuleMoney(measure as RuleMeasure);
  const v = raw.replace(/\s/g, '').replace(',', '.');
  if (money && (condition === 'above' || condition === 'below')) {
    const digits = currencyDigits(currency || 'USD');
    const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(v);
    if (!m) return null;
    const frac = m[2] ?? '';
    if (frac.length > digits) return null;
    return Number(m[1]) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
  }
  return /^\d{1,13}$/.test(v) ? Number(v) : null;
}

/** A stored threshold back as the form shows it (major units for money). */
export function thresholdText(
  threshold: number,
  measure: string,
  condition: string,
  currency: string,
): string {
  const money = (RULE_MEASURES as readonly string[]).includes(measure) && isRuleMoney(measure as RuleMeasure);
  if (!money || (condition !== 'above' && condition !== 'below')) return String(threshold);
  const digits = currencyDigits(currency || 'USD');
  if (digits === 0) return String(threshold);
  const s = String(threshold).padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}
