import type { Pass } from '../../src/shop/selection';
import {
  cartFingerprint,
  cartIssues,
  maxQuantity,
  minQuantity,
  passStatus,
  stepQuantity,
  summarize,
  withQuantity,
} from '../../src/shop/selection';

const pass = (over: Partial<Pass> = {}): Pass => ({
  accessDates: [],
  allInMinor: 2500,
  availability: 'available',
  currency: 'EUR',
  description: null,
  earlyEndsAt: null,
  fewLeft: false,
  id: 'p1',
  isDonation: false,
  maxPerOrder: 4,
  minPerOrder: 1,
  name: 'General',
  regularAllInMinor: null,
  ...over,
});

describe('quantities follow the web’s rules', () => {
  it('steps between 0, the minimum and the maximum', () => {
    const p = pass({ minPerOrder: 2, maxPerOrder: 4 });
    expect(minQuantity(p)).toBe(2);
    expect(maxQuantity(p)).toBe(4);
    expect(stepQuantity(p, 0, 1)).toBe(2);
    expect(stepQuantity(p, 2, 1)).toBe(3);
    expect(stepQuantity(p, 4, 1)).toBe(4);
    expect(stepQuantity(p, 3, -1)).toBe(2);
    expect(stepQuantity(p, 2, -1)).toBe(0);
    expect(stepQuantity(p, 0, -1)).toBe(0);
  });

  it('a minimum above the maximum is held to the maximum; a maximum of zero sells nothing', () => {
    expect(minQuantity(pass({ minPerOrder: 9, maxPerOrder: 4 }))).toBe(4);
    expect(stepQuantity(pass({ maxPerOrder: 0 }), 0, 1)).toBe(0);
  });

  it('clamps a quantity set directly', () => {
    const p = pass({ minPerOrder: 2, maxPerOrder: 4 });
    expect(withQuantity({}, p, 1)).toEqual({ p1: 2 });
    expect(withQuantity({}, p, 9)).toEqual({ p1: 4 });
    expect(withQuantity({ p1: 3 }, p, 0)).toEqual({});
    expect(withQuantity({ p1: 3 }, p, -2)).toEqual({});
    expect(withQuantity({ other: 1 }, p, 2.7)).toEqual({ other: 1, p1: 2 });
  });
});

describe('what can be chosen', () => {
  it('only an on-sale pass can; sold out, not yet and ended cannot', () => {
    expect(passStatus(pass(), new Set(), false)).toBe('buyable');
    expect(passStatus(pass({ availability: 'sold_out' }), new Set(), false)).toBe('sold_out');
    expect(passStatus(pass({ availability: 'not_yet_on_sale' }), new Set(), false)).toBe('not_yet_on_sale');
    expect(passStatus(pass({ availability: 'sales_ended' }), new Set(), false)).toBe('sales_ended');
  });

  it('streamed passes are web-only: every pass of an online event, the named ones of a hybrid one', () => {
    expect(passStatus(pass(), new Set(), true)).toBe('web_only');
    expect(passStatus(pass(), new Set(['p1']), false)).toBe('web_only');
    expect(passStatus(pass({ id: 'p2' }), new Set(['p1']), false)).toBe('buyable');
    // Not on sale stays not on sale: the reason the person needs is the sale window.
    expect(passStatus(pass({ availability: 'sold_out' }), new Set(['p1']), true)).toBe('sold_out');
  });
});

describe('the cart', () => {
  const passes = [pass(), pass({ id: 'p2', name: 'VIP', allInMinor: 9000, maxPerOrder: 2 })];

  it('totals the all-in prices', () => {
    const s = summarize(passes, { p1: 2, p2: 1 });
    expect(s.count).toBe(3);
    expect(s.totalMinor).toBe(2 * 2500 + 9000);
    expect(s.currency).toBe('EUR');
    expect(s.lines.map((l) => [l.pass.id, l.quantity, l.lineMinor])).toEqual([
      ['p1', 2, 5000],
      ['p2', 1, 9000],
    ]);
    expect(summarize(passes, {})).toMatchObject({ count: 0, totalMinor: 0, currency: null });
  });

  it('names what stops it', () => {
    const none = new Set<string>();
    expect(cartIssues(passes, {}, none, false)).toEqual([{ kind: 'empty' }]);
    expect(cartIssues(passes, { p1: 1 }, none, false)).toEqual([]);
    expect(cartIssues(passes, { gone: 1 }, none, false)).toEqual([{ kind: 'unavailable', passId: 'gone' }]);
    expect(cartIssues(passes, { p2: 3 }, none, false)).toEqual([
      { kind: 'above_maximum', passId: 'p2', maximum: 2 },
    ]);
    expect(cartIssues([pass({ minPerOrder: 2 })], { p1: 1 }, none, false)).toEqual([
      { kind: 'below_minimum', passId: 'p1', minimum: 2 },
    ]);
    expect(cartIssues([pass({ availability: 'sold_out' })], { p1: 1 }, none, false)).toEqual([
      { kind: 'unavailable', passId: 'p1' },
    ]);
    expect(cartIssues(passes, { p1: 1 }, new Set(['p1']), false)).toEqual([
      { kind: 'web_only', passId: 'p1' },
    ]);
    expect(cartIssues(passes, { p1: 1 }, none, true)).toEqual([{ kind: 'web_only', passId: 'p1' }]);
  });

  it('gives the same cart the same fingerprint, whatever the order, and a changed cart another', () => {
    const a = cartFingerprint({ p1: 2, p2: 1 }, null, 'SAVE10');
    expect(cartFingerprint({ p2: 1, p1: 2 }, null, ' save10 ')).toBe(a);
    expect(cartFingerprint({ p1: 3, p2: 1 }, null, 'SAVE10')).not.toBe(a);
    expect(cartFingerprint({ p1: 2, p2: 1 }, 'date-1', 'SAVE10')).not.toBe(a);
    expect(cartFingerprint({ p1: 2, p2: 1 }, null, '')).not.toBe(a);
    expect(cartFingerprint({ p1: 2, p3: 0 }, null, '')).toBe(cartFingerprint({ p1: 2 }, null, ''));
  });
});
