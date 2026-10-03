import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROCESSING_FEE,
  giftAmountProblem,
  processingFeeCover,
  shownName,
} from '../src/domain/giving.ts';
import { PublicGivingDto, StartGiftInput } from '../src/dto.ts';

describe('processingFeeCover (P4-10)', () => {
  it('leaves the charity the whole gift after 2.9 % + 30', () => {
    for (const gift of [100, 500, 2_500, 10_000, 100_000, 1_234_567, 99_999_999]) {
      const cover = processingFeeCover(gift);
      const charge = gift + cover;
      const fee =
        Math.round((charge * DEFAULT_PROCESSING_FEE.percentBps) / 10_000) + DEFAULT_PROCESSING_FEE.fixedMinor;
      // Enough: the charity nets at least the gift …
      expect(charge - fee).toBeGreaterThanOrEqual(gift);
      // … and not a cent more than needed.
      const less = charge - 1;
      const feeLess =
        Math.ceil((less * DEFAULT_PROCESSING_FEE.percentBps) / 10_000) + DEFAULT_PROCESSING_FEE.fixedMinor;
      expect(less - feeLess).toBeLessThan(gift + 1);
    }
  });

  it('known values', () => {
    expect(processingFeeCover(10_000)).toBe(330);
    expect(processingFeeCover(100_000)).toBe(3_018);
    expect(processingFeeCover(2_500)).toBe(106);
  });

  it('nothing for a non-positive or fractional amount', () => {
    expect(processingFeeCover(0)).toBe(0);
    expect(processingFeeCover(-5)).toBe(0);
    expect(processingFeeCover(10.5)).toBe(0);
  });

  it('another rule (a nonprofit rate)', () => {
    expect(processingFeeCover(10_000, { percentBps: 220, fixedMinor: 30 })).toBe(256);
  });
});

describe('giftAmountProblem', () => {
  const limits = { minGiftMinor: 500, maxGiftMinor: 100_000 };
  it('accepts the limits themselves', () => {
    expect(giftAmountProblem(500, limits)).toBeNull();
    expect(giftAmountProblem(100_000, limits)).toBeNull();
  });
  it('names the problem', () => {
    expect(giftAmountProblem(499, limits)).toBe('amount_min');
    expect(giftAmountProblem(100_001, limits)).toBe('amount_max');
    expect(giftAmountProblem(0, limits)).toBe('amount');
    expect(giftAmountProblem(Number.NaN, limits)).toBe('amount');
    expect(giftAmountProblem(12.5, limits)).toBe('amount');
  });
});

describe('shownName (P4-13)', () => {
  it('as the donor chose', () => {
    expect(shownName('  Ada   Lovelace ', 'full_name')).toBe('Ada Lovelace');
    expect(shownName('Ada Lovelace', 'first_name')).toBe('Ada');
    expect(shownName('Ada Lovelace', 'anonymous')).toBeNull();
  });
});

describe('the public giving payload is an allowlist', () => {
  it('strips anything about donors or gifts', () => {
    const parsed = PublicGivingDto.parse({
      available: true,
      processingFee: DEFAULT_PROCESSING_FEE,
      campaigns: [
        {
          id: '01900000-0000-7000-8000-000000000001',
          name: 'Fund',
          description: null,
          goalMinor: 1_000,
          currency: 'USD',
          minGiftMinor: 100,
          maxGiftMinor: 1_000,
          raisedMinor: 500,
          giftCount: 1,
          levels: [],
          gifts: [{ donorName: 'Ada', amountMinor: 500 }],
          donorEmail: 'ada@example.test',
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/Ada|ada@|donor|gifts/);
  });
});

describe('StartGiftInput', () => {
  const base = {
    eventId: '01900000-0000-7000-8000-000000000001',
    campaignId: '01900000-0000-7000-8000-000000000002',
    donor: { name: 'Ada', email: ' Ada@Example.TEST ' },
    displayAs: 'anonymous',
  };
  it('takes a level or an amount, never both or neither', () => {
    expect(StartGiftInput.safeParse({ ...base, amountMinor: 1_000 }).success).toBe(true);
    expect(StartGiftInput.safeParse({ ...base, levelId: base.campaignId }).success).toBe(true);
    expect(StartGiftInput.safeParse({ ...base, levelId: base.campaignId, amountMinor: 1_000 }).success).toBe(
      false,
    );
    expect(StartGiftInput.safeParse(base).success).toBe(false);
  });
  it('normalizes the email, defaults the fee cover off and empties blank optionals', () => {
    const v = StartGiftInput.parse({ ...base, amountMinor: 1_000, employer: '  ', tribute: null });
    expect(v.donor.email).toBe('ada@example.test');
    expect(v.coverFee).toBe(false);
    expect(v.employer).toBeNull();
    expect(v.tribute).toBeNull();
  });
  it('a tribute needs a kind and a name', () => {
    expect(
      StartGiftInput.safeParse({ ...base, amountMinor: 1, tribute: { kind: 'honor', name: '' } }).success,
    ).toBe(false);
    expect(
      StartGiftInput.safeParse({ ...base, amountMinor: 1, tribute: { kind: 'gift', name: 'X' } }).success,
    ).toBe(false);
  });
});
