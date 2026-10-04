import { describe, expect, it } from 'vitest';
import { parseThreshold, thresholdText } from '../src/lib/rule-threshold.ts';

describe('alert rule thresholds (M6.2b)', () => {
  it('money amounts become integer minor units in the currency’s decimals', () => {
    expect(parseThreshold('12.50', 'gross', 'above', 'USD')).toBe(1250);
    expect(parseThreshold('12,5', 'net', 'below', 'EUR')).toBe(1250);
    expect(parseThreshold('100', 'refunds', 'above', 'USD')).toBe(10_000);
    expect(parseThreshold('0.07', 'gross', 'above', 'USD')).toBe(7);
    expect(parseThreshold('1500', 'gross', 'above', 'JPY')).toBe(1500);
    expect(parseThreshold('1.5', 'gross', 'above', 'JPY')).toBeNull();
    expect(parseThreshold('1.2345', 'gross', 'above', 'USD')).toBeNull();
    expect(parseThreshold('1.234', 'gross', 'above', 'KWD')).toBe(1234);
    expect(parseThreshold('-5', 'gross', 'above', 'USD')).toBeNull();
    expect(parseThreshold('abc', 'gross', 'above', 'USD')).toBeNull();
  });
  it('counts and percentages are whole numbers', () => {
    expect(parseThreshold('10', 'registrations', 'above', '')).toBe(10);
    expect(parseThreshold('25', 'gross', 'rise', 'USD')).toBe(25);
    expect(parseThreshold('2.5', 'tickets', 'below', '')).toBeNull();
    expect(parseThreshold('', 'tickets', 'below', '')).toBeNull();
  });
  it('round-trips for the edit form', () => {
    expect(thresholdText(1250, 'gross', 'above', 'USD')).toBe('12.50');
    expect(thresholdText(7, 'gross', 'above', 'USD')).toBe('0.07');
    expect(thresholdText(1500, 'gross', 'above', 'JPY')).toBe('1500');
    expect(thresholdText(25, 'gross', 'rise', 'USD')).toBe('25');
    expect(thresholdText(10, 'registrations', 'above', '')).toBe('10');
  });
});
