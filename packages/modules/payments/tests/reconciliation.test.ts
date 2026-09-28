import { describe, expect, it } from 'vitest';
import {
  dayBounds,
  fakePaymentProvider,
  memoryBalanceStore,
  reconcileEntries,
  reconWindow,
} from '../src/index.ts';

const at = (iso: string) => new Date(iso);
const e = (reference: string, amountMinor: number, iso: string, currency = 'USD') => ({
  reference,
  currency,
  amountMinor,
  occurredAt: at(iso),
});
const DAY = '2027-05-10';

describe('daily reconciliation — matching (M1.6e)', () => {
  it('a day whose sides agree has no differences', () => {
    const ledger = [
      e('order:1', 5250, '2027-05-10T10:00:00Z'),
      e('refund:r1', -1000, '2027-05-10T11:00:00Z'),
    ];
    const provider = [
      e('order:1', 5250, '2027-05-10T10:00:01Z'),
      e('refund:r1', -1000, '2027-05-10T11:00:02Z'),
    ];
    expect(reconcileEntries(DAY, ledger, provider)).toEqual([]);
  });

  it('names what is missing on each side and what differs', () => {
    const ledger = [
      e('order:1', 5250, '2027-05-10T10:00:00Z'),
      e('settlement:s1', -9000, '2027-05-10T12:00:00Z'),
    ];
    const provider = [
      e('order:1', 5200, '2027-05-10T10:00:00Z'),
      e('refund:r9', -700, '2027-05-10T13:00:00Z'),
    ];
    expect(reconcileEntries(DAY, ledger, provider)).toEqual([
      {
        kind: 'amount_mismatch',
        reference: 'order:1',
        currency: 'USD',
        ledgerMinor: 5250,
        providerMinor: 5200,
      },
      {
        kind: 'missing_in_ledger',
        reference: 'refund:r9',
        currency: 'USD',
        ledgerMinor: 0,
        providerMinor: -700,
      },
      {
        kind: 'missing_at_provider',
        reference: 'settlement:s1',
        currency: 'USD',
        ledgerMinor: -9000,
        providerMinor: 0,
      },
    ]);
  });

  it('money crossing midnight still matches; only references with something on the day are checked', () => {
    // The charge landed at 23:59:59 on the 10th; the ledger booked the webhook at 00:00:03 on the 11th.
    const ledger = [e('order:2', 3000, '2027-05-11T00:00:03Z'), e('order:3', 100, '2027-05-09T08:00:00Z')];
    const provider = [e('order:2', 3000, '2027-05-10T23:59:59Z')];
    expect(reconcileEntries(DAY, ledger, provider)).toEqual([]);
  });

  it('several movements under one reference net out (a dispute lost then won); currencies are separate', () => {
    const provider = [
      e('dispute:du_1', -1500, '2027-05-10T09:00:00Z'),
      e('dispute:du_1', 1500, '2027-05-10T18:00:00Z'),
      e('order:4', 900, '2027-05-10T09:00:00Z', 'EUR'),
    ];
    const ledger = [
      e('dispute:du_1', -1500, '2027-05-10T09:00:00Z'),
      e('dispute:du_1', 1500, '2027-05-10T18:00:00Z'),
      e('order:4', 900, '2027-05-10T09:00:00Z', 'USD'),
    ];
    expect(reconcileEntries(DAY, ledger, provider).map((d) => [d.kind, d.currency])).toEqual([
      ['missing_in_ledger', 'EUR'],
      ['missing_at_provider', 'USD'],
    ]);
  });

  it('the window is the UTC day ± one day; a malformed day is refused', () => {
    expect(dayBounds(DAY)).toEqual({ start: at('2027-05-10T00:00:00Z'), end: at('2027-05-11T00:00:00Z') });
    expect(reconWindow(DAY)).toEqual({ from: at('2027-05-09T00:00:00Z'), to: at('2027-05-12T00:00:00Z') });
    expect(() => dayBounds('2027-02-30')).toThrow();
  });
});

describe('fake provider balance store', () => {
  const secret = 'x'.repeat(32);
  it('records what the fake did with the ledger references; without a store it cannot list', async () => {
    const store = memoryBalanceStore();
    let now = at('2027-05-10T10:00:00Z');
    const fake = fakePaymentProvider({ secret, appOrigin: 'http://x', store, now: () => now });
    await fake.refund({
      providerPaymentId: 'fakepi_1',
      amount: { amount: 500, currency: 'USD' },
      connectedAccountId: null,
      refundApplicationFee: { amount: 0, currency: 'USD' },
      idempotencyKey: 'refund:r1',
      orgId: 'o1',
    });
    await fake.refund({
      providerPaymentId: 'fakepi_2',
      amount: { amount: 500, currency: 'USD' },
      connectedAccountId: 'fakeacct_1',
      refundApplicationFee: { amount: 50, currency: 'USD' },
      idempotencyKey: 'refund:r2',
      orgId: 'o1',
    });
    now = at('2027-05-10T11:00:00Z');
    await fake.createTransfer({
      destinationAccountId: 'fakeacct_1',
      amount: { amount: 9000, currency: 'USD' },
      transferGroup: 'event:e',
      idempotencyKey: 'settlement:s1',
      orgId: 'o1',
    });
    await fake.reverseTransfer({
      transferId: 't',
      amount: { amount: 300, currency: 'USD' },
      idempotencyKey: 'reversal:r1',
      orgId: 'o1',
    });
    // A failed reversal moves nothing.
    await fake.reverseTransfer({
      transferId: 't',
      amount: { amount: 200_000, currency: 'USD' },
      idempotencyKey: 'reversal:r3',
      orgId: 'o1',
    });
    const listed = await fake.listBalanceTransactions(reconWindow(DAY));
    expect(listed?.map((t) => [t.kind, t.amountMinor, t.reference])).toEqual([
      ['refund', -500, 'refund:r1'],
      ['application_fee_refund', -50, 'refund:r2'],
      ['transfer', -9000, 'settlement:s1'],
      ['transfer_reversal', 300, 'reversal:r1'],
    ]);
    const bare = fakePaymentProvider({ secret, appOrigin: 'http://x' });
    expect(await bare.listBalanceTransactions(reconWindow(DAY))).toBeNull();
  });
});
