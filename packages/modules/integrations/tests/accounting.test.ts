import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CATEGORIES,
  type AccountMap,
  addDays,
  type DayHistoryRow,
  type DaySummary,
  dayIn,
  debitTotal,
  decimalToMinor,
  EMPTY_SUMMARY,
  journalKey,
  journalLines,
  journalReference,
  linesBalance,
  minorToDecimal,
  planDay,
  type ProviderAccount,
  reversalLines,
  summaryKey,
  validateAccountMap,
} from '../src/accounting/domain.ts';

const acct = (id: string): ProviderAccount => ({ id, code: id.toUpperCase(), name: `Account ${id}`, type: 'X' });
const MAP: AccountMap = {
  sales: acct('s'),
  donations: acct('d'),
  refunds: acct('r'),
  fees: acct('f'),
  payouts: acct('p'),
  clearing: acct('c'),
};
const DAY: DaySummary = {
  salesMinor: 25_000,
  donationsMinor: 10_300,
  refundsMinor: 4_000,
  feesMinor: 1_150,
  payoutsMinor: 12_000,
};

describe('daily summary journal lines (P6-6)', () => {
  it('credits income, debits refunds, fees and payouts, and balances on clearing', () => {
    const lines = journalLines(DAY, MAP);
    expect(lines.map((l) => [l.category, l.accountId, l.amountMinor])).toEqual([
      ['sales', 's', -25_000],
      ['donations', 'd', -10_300],
      ['refunds', 'r', 4_000],
      ['fees', 'f', 1_150],
      ['payouts', 'p', 12_000],
      ['clearing', 'c', 25_000 + 10_300 - 4_000 - 1_150 - 12_000],
    ]);
    expect(linesBalance(lines)).toBe(true);
    expect(debitTotal(lines)).toBe(4_000 + 1_150 + 12_000 + 18_150);
  });

  it('leaves zero lines out and flips a negative clearing to a credit', () => {
    const lines = journalLines({ ...EMPTY_SUMMARY, payoutsMinor: 5_000 }, MAP);
    expect(lines.map((l) => [l.category, l.amountMinor])).toEqual([
      ['payouts', 5_000],
      ['clearing', -5_000],
    ]);
    expect(journalLines(EMPTY_SUMMARY, MAP)).toEqual([]);
  });

  it('a fee refund larger than the day’s fees credits the fee account', () => {
    const lines = journalLines({ ...EMPTY_SUMMARY, refundsMinor: 1_000, feesMinor: -50 }, MAP);
    expect(lines.find((l) => l.category === 'fees')?.amountMinor).toBe(-50);
    expect(linesBalance(lines)).toBe(true);
  });

  it('a reversal undoes the journal exactly', () => {
    const lines = journalLines(DAY, MAP);
    const back = reversalLines(lines);
    expect(back.map((l, i) => l.amountMinor + (lines[i]?.amountMinor ?? 0))).toEqual(lines.map(() => 0));
    expect(back.map((l) => l.accountId)).toEqual(lines.map((l) => l.accountId));
    expect(linesBalance(back)).toBe(true);
  });

  it('refuses non-integer amounts', () => {
    expect(() => journalLines({ ...DAY, salesMinor: 1.5 }, MAP)).toThrow();
  });
});

describe('chart-of-accounts mapping', () => {
  const chart = ACCOUNT_CATEGORIES.map((c) => acct(c[0] as string));
  const chosen = { sales: 's', donations: 'd', refunds: 'r', fees: 'f', payouts: 'p', clearing: 'c' };
  it('accepts every category mapped to a known account (shared income accounts allowed)', () => {
    expect(validateAccountMap(chosen, chart)).toEqual([]);
    expect(validateAccountMap({ ...chosen, donations: 's', refunds: 's' }, chart)).toEqual([]);
  });
  it('names missing, unknown and clearing-shared categories', () => {
    expect(validateAccountMap({ ...chosen, fees: '' }, chart)).toEqual([{ category: 'fees', code: 'missing' }]);
    expect(validateAccountMap({ ...chosen, sales: 'gone' }, chart)).toEqual([
      { category: 'sales', code: 'unknown_account' },
    ]);
    expect(validateAccountMap({ ...chosen, payouts: 'c' }, chart)).toEqual([
      { category: 'payouts', code: 'clearing_shared' },
    ]);
  });
});

describe('re-posting on correction: reverse and re-post, never edit', () => {
  const row = (p: Partial<DayHistoryRow> & Pick<DayHistoryRow, 'id' | 'kind' | 'status'>): DayHistoryRow => ({
    revision: 1,
    summaryKey: p.kind === 'journal' ? summaryKey(DAY) : null,
    reversesId: null,
    uncertain: false,
    mapVersion: 1,
    ...p,
  });
  const later = { ...DAY, refundsMinor: DAY.refundsMinor + 2_500 };

  it('posts a new day once; a re-run with the same totals writes nothing new', () => {
    expect(planDay([], DAY, 1)).toMatchObject({ post: true, reverse: null, unchanged: false });
    const pending = [row({ id: 'j1', kind: 'journal', status: 'pending' })];
    expect(planDay(pending, DAY, 1)).toMatchObject({ post: false, unchanged: true, supersede: [] });
    const posted = [row({ id: 'j1', kind: 'journal', status: 'posted' })];
    expect(planDay(posted, DAY, 1)).toMatchObject({ post: false, unchanged: true, supersede: [] });
  });

  it('a late refund reverses the posted journal and posts the next revision', () => {
    const posted = [row({ id: 'j1', kind: 'journal', status: 'posted' })];
    expect(planDay(posted, later, 1)).toEqual({
      supersede: [],
      reverse: 'j1',
      post: true,
      unchanged: false,
      blocked: false,
    });
    // Once both are queued, a re-run keeps them.
    const queued = [
      ...posted,
      row({ id: 'r1', kind: 'reversal', status: 'pending', reversesId: 'j1', revision: 1 }),
      row({ id: 'j2', kind: 'journal', status: 'pending', revision: 2, summaryKey: summaryKey(later) }),
    ];
    expect(planDay(queued, later, 1)).toMatchObject({ unchanged: true, post: false });
    // And after they are posted, revision 2 stands.
    const done = queued.map((r) => ({ ...r, status: 'posted' as const }));
    expect(planDay(done, later, 1)).toMatchObject({ unchanged: true, post: false, reverse: null });
  });

  it('a day that goes back to zero is only reversed', () => {
    const posted = [row({ id: 'j1', kind: 'journal', status: 'posted' })];
    expect(planDay(posted, EMPTY_SUMMARY, 1)).toMatchObject({ reverse: 'j1', post: false });
    expect(planDay([], EMPTY_SUMMARY, 1)).toMatchObject({ unchanged: true, post: false });
  });

  it('unsent rows are replaced, never sent stale; a change back to what stands drops them', () => {
    const posted = row({ id: 'j1', kind: 'journal', status: 'posted' });
    const stale = [
      posted,
      row({ id: 'r1', kind: 'reversal', status: 'pending', reversesId: 'j1' }),
      row({ id: 'j2', kind: 'journal', status: 'pending', revision: 2, summaryKey: summaryKey(later) }),
    ];
    const third = { ...later, salesMinor: later.salesMinor + 1 };
    expect(planDay(stale, third, 1)).toMatchObject({ supersede: ['r1', 'j2'], reverse: 'j1', post: true });
    expect(planDay(stale, DAY, 1)).toMatchObject({ supersede: ['r1', 'j2'], reverse: null, post: false });
  });

  it('an unsent journal built with an older mapping is rebuilt', () => {
    const pending = [row({ id: 'j1', kind: 'journal', status: 'failed', mapVersion: 1 })];
    expect(planDay(pending, DAY, 2)).toMatchObject({ supersede: ['j1'], post: true });
  });

  it('waits while an attempt may have reached the provider', () => {
    const inFlight = [row({ id: 'j1', kind: 'journal', status: 'failed', uncertain: true })];
    expect(planDay(inFlight, later, 1)).toMatchObject({ blocked: true, post: false, supersede: [] });
  });
});

describe('keys, references and exact decimals', () => {
  it('idempotency is org + day + currency + revision', () => {
    expect(journalKey('o1', '2026-10-01', 'USD', 2, 'journal')).toBe('yayatoh:o1:2026-10-01:USD:r2');
    expect(journalKey('o1', '2026-10-01', 'USD', 1, 'reversal')).toBe('yayatoh:o1:2026-10-01:USD:r1:reversal');
    expect(journalReference('2026-10-01', 'USD', 12, 'reversal')).toBe('YY-20261001-USD-12R');
    expect(journalReference('2026-10-01', 'USD', 12, 'reversal').length).toBeLessThanOrEqual(21);
  });

  it('converts minor units without floating point', () => {
    expect(minorToDecimal(12_345, 2)).toBe('123.45');
    expect(minorToDecimal(-5, 2)).toBe('-0.05');
    expect(minorToDecimal(7, 0)).toBe('7');
    expect(minorToDecimal(1_005, 3)).toBe('1.005');
    expect(minorToDecimal(9_007_199_254_740_991, 2)).toBe('90071992547409.91');
    expect(decimalToMinor('123.45', 2)).toBe(12_345);
    expect(decimalToMinor(0.1 + 0.2 > 0.3 ? '0.30' : '0.3', 2)).toBe(30);
    expect(decimalToMinor('1.005', 2)).toBeNull();
    expect(decimalToMinor('-0.05', 2)).toBe(-5);
    expect(decimalToMinor('abc', 2)).toBeNull();
    for (const n of [0, 1, 99, 100, 101, 123_456_789]) expect(decimalToMinor(minorToDecimal(n, 2), 2)).toBe(n);
  });

  it('days follow the org time zone', () => {
    const late = new Date('2026-10-02T03:30:00Z');
    expect(dayIn(late, 'America/New_York')).toBe('2026-10-01');
    expect(dayIn(late, 'Asia/Tokyo')).toBe('2026-10-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
