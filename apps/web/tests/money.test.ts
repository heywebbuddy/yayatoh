import { describe, expect, it } from 'vitest';
import { dayLabel, deltaOf, exportHref, isGrain, periodQuery } from '../src/lib/money.ts';

describe('Money page helpers (U5)', () => {
  it('keeps a period (and grain) in links and exports', () => {
    expect(periodQuery({ period: '30d', from: '2026-10-01', to: '2026-10-30' })).toBe('period=30d');
    expect(periodQuery({ period: 'custom', from: '2026-10-01', to: '2026-10-30' }, { grain: 'week' })).toBe(
      'period=custom&from=2026-10-01&to=2026-10-30&grain=week',
    );
    expect(exportHref('en', 'acme', 'fees', 'period=all')).toBe('/o/acme/money/export?view=fees&period=all');
    expect(exportHref('ar', 'acme', 'payouts', '')).toBe('/ar/o/acme/money/export?view=payouts');
  });

  it('accepts only known grains', () => {
    expect(isGrain('week')).toBe(true);
    expect(isGrain('auto')).toBe(false);
    expect(isGrain(undefined)).toBe(false);
  });

  it('shows the change against the previous period, with a tone by direction of money', () => {
    expect(deltaOf(1200, 1000, 'en', 'in', 'New')).toEqual({ delta: '+20%', tone: 'success' });
    expect(deltaOf(800, 1000, 'en', 'in', 'New')).toEqual({ delta: '-20%', tone: 'danger' });
    // Money out (refunds, fees): no judgement.
    expect(deltaOf(1200, 1000, 'en', 'out', 'New')).toEqual({ delta: '+20%', tone: 'neutral' });
    expect(deltaOf(500, 0, 'en', 'in', 'New')).toEqual({ delta: 'New', tone: 'primary' });
    expect(deltaOf(0, 0, 'en', 'in', 'New')).toEqual({ tone: 'neutral' });
    expect(deltaOf(5, null, 'en', 'in', 'New')).toEqual({ tone: 'neutral' });
  });

  it('labels calendar days without shifting them across time zones', () => {
    expect(dayLabel('2026-11-01', 'en')).toBe('Nov 1');
    expect(dayLabel('2026-11-01', 'en', 'month')).toBe('Nov 2026');
  });
});
