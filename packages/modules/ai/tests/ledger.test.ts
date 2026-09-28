import { describe, expect, it } from 'vitest';
import {
  type CreditState,
  debit,
  effectiveBalance,
  FREE_MONTHLY_CREDITS,
  type LedgerEntry,
  ledgerBalance,
  periodOf,
  refund,
  rollover,
} from '../src/domain/ledger.ts';

describe('AI credit ledger arithmetic', () => {
  it('periods are UTC months', () => {
    expect(periodOf(new Date('2030-03-31T23:59:59Z'))).toBe('2030-03');
    expect(periodOf(new Date('2030-04-01T00:00:00Z'))).toBe('2030-04');
  });

  it('a new account opens with the free allowance as one grant', () => {
    const { state, entries } = rollover(null, '2030-03', FREE_MONTHLY_CREDITS);
    expect(state).toEqual({ balance: FREE_MONTHLY_CREDITS, period: '2030-03' });
    expect(entries).toEqual([
      { kind: 'grant', amount: FREE_MONTHLY_CREDITS, balanceAfter: FREE_MONTHLY_CREDITS },
    ]);
  });

  it('the same month changes nothing', () => {
    const acct = { balance: 3, period: '2030-03' };
    expect(rollover(acct, '2030-03', 20)).toEqual({ state: acct, entries: [] });
  });

  it('a new month tops up to the allowance (unused free credits do not pile up)', () => {
    const { state, entries } = rollover({ balance: 3, period: '2030-02' }, '2030-03', 20);
    expect(state).toEqual({ balance: 20, period: '2030-03' });
    expect(entries).toEqual([{ kind: 'grant', amount: 17, balanceAfter: 20 }]);
  });

  it('credits above the allowance are kept across months', () => {
    const { state, entries } = rollover({ balance: 50, period: '2030-02' }, '2030-03', 20);
    expect(state).toEqual({ balance: 50, period: '2030-03' });
    expect(entries).toEqual([]);
  });

  it('effectiveBalance shows the topped-up amount without writing', () => {
    expect(effectiveBalance({ balance: 0, period: '2030-02' }, '2030-03', 20)).toBe(20);
    expect(effectiveBalance({ balance: 0, period: '2030-03' }, '2030-03', 20)).toBe(0);
  });

  it('a debit spends one credit and refuses at zero, never going negative', () => {
    let state: CreditState = { balance: 2, period: '2030-03' };
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < 5; i++) {
      const r = debit(state);
      if (!r.ok) continue;
      state = r.state;
      entries.push(r.entry);
    }
    expect(state.balance).toBe(0);
    expect(entries).toEqual([
      { kind: 'debit', amount: -1, balanceAfter: 1 },
      { kind: 'debit', amount: -1, balanceAfter: 0 },
    ]);
    expect(debit(state)).toEqual({ ok: false });
    expect(debit({ balance: 1, period: '2030-03' }, 2)).toEqual({ ok: false });
  });

  it('a refund gives the debit back', () => {
    expect(refund({ balance: 4, period: '2030-03' }, -1)).toEqual({
      state: { balance: 5, period: '2030-03' },
      entry: { kind: 'refund', amount: 1, balanceAfter: 5 },
    });
  });

  it('the ledger always sums to the balance', () => {
    let { state, entries } = rollover(null, '2030-02', 5);
    const all: LedgerEntry[] = [...entries];
    for (let i = 0; i < 3; i++) {
      const r = debit(state);
      if (r.ok) {
        state = r.state;
        all.push(r.entry);
      }
    }
    const back = refund(state, -1);
    state = back.state;
    all.push(back.entry);
    ({ state, entries } = rollover(state, '2030-03', 5));
    all.push(...entries);
    expect(state.balance).toBe(5);
    expect(ledgerBalance(all)).toBe(state.balance);
    expect(all.at(-1)?.balanceAfter).toBe(state.balance);
  });

  it('rejects nonsense inputs', () => {
    expect(() => rollover(null, '2030-03', -1)).toThrow();
    expect(() => debit({ balance: 3, period: '2030-03' }, 0)).toThrow();
  });
});
