import { describe, expect, it } from 'vitest';
import {
  deductibleMinor,
  exemptProblem,
  formatReceiptNumber,
  giftReceiptAmounts,
  isDeductibleReceipt,
  normalizeEin,
  parseEoBmf,
  quidProQuoNotice,
  RECEIPT_COPY,
  receiptEmailBody,
  recordedExemptOrgLookup,
  statementTotals,
  statementYearDue,
  taxNoticeText,
  taxYearOf,
  ticketReceiptAmounts,
} from '../src/index.ts';

describe('receipt amounts (P4-11)', () => {
  it('a $500 ticket with a $150 fair-market value: $350 deductible', () => {
    const a = ticketReceiptAmounts([
      {
        name: 'Gala dinner',
        quantity: 1,
        unitPaidMinor: 50_000,
        unitFmvMinor: 15_000,
        description: 'Dinner',
      },
    ]);
    expect(a).toEqual({
      amountMinor: 50_000,
      fmvMinor: 15_000,
      deductibleMinor: 35_000,
      goods: '1 × Gala dinner (Dinner)',
    });
  });

  it('several lines; a line without a value counts at its full price; a value never exceeds the price', () => {
    const a = ticketReceiptAmounts([
      { name: 'Gala', quantity: 2, unitPaidMinor: 50_000, unitFmvMinor: 15_000, description: null },
      { name: 'Parking', quantity: 1, unitPaidMinor: 2_000, unitFmvMinor: null, description: null },
      { name: 'Comp', quantity: 1, unitPaidMinor: 1_000, unitFmvMinor: 9_000, description: null },
    ]);
    expect(a.amountMinor).toBe(103_000);
    expect(a.fmvMinor).toBe(30_000 + 2_000 + 1_000);
    expect(a.deductibleMinor).toBe(70_000);
    expect(a.goods).toBe('2 × Gala; 1 × Parking; 1 × Comp');
  });

  it('a gift: everything charged (fee cover included) is deductible, nothing received', () => {
    expect(giftReceiptAmounts(10_000)).toEqual({
      amountMinor: 10_000,
      fmvMinor: 0,
      deductibleMinor: 10_000,
      goods: null,
    });
  });

  it('deductible is never below zero and needs integer minor units', () => {
    expect(deductibleMinor(5_000, 9_000)).toBe(0);
    expect(deductibleMinor(5_000, -1)).toBe(5_000);
    expect(() => deductibleMinor(1.5, 0)).toThrow();
  });

  it('only a verified charity, paid to its own account, in USD, issues deductible receipts', () => {
    const ok = { charityStatus: 'verified' as const, fundsFlow: 'organizer_mor', currency: 'USD' };
    expect(isDeductibleReceipt(ok)).toBe(true);
    expect(isDeductibleReceipt({ ...ok, charityStatus: 'pending' })).toBe(false);
    expect(isDeductibleReceipt({ ...ok, charityStatus: 'rejected' })).toBe(false);
    expect(isDeductibleReceipt({ ...ok, charityStatus: null })).toBe(false);
    expect(isDeductibleReceipt({ ...ok, fundsFlow: 'platform_mor' })).toBe(false);
    expect(isDeductibleReceipt({ ...ok, currency: 'EUR' })).toBe(false);
  });
});

describe('the quid-pro-quo notice', () => {
  it('shows over $75 with a fair-market value, in USD', () => {
    expect(quidProQuoNotice({ priceMinor: 50_000, fmvMinor: 15_000, currency: 'USD' })).toEqual({
      priceMinor: 50_000,
      fmvMinor: 15_000,
      deductibleMinor: 35_000,
    });
    expect(quidProQuoNotice({ priceMinor: 7_500, fmvMinor: 1_000, currency: 'USD' })).toBeNull();
    expect(quidProQuoNotice({ priceMinor: 7_501, fmvMinor: 1_000, currency: 'USD' })).not.toBeNull();
    expect(quidProQuoNotice({ priceMinor: 50_000, fmvMinor: null, currency: 'USD' })).toBeNull();
    expect(quidProQuoNotice({ priceMinor: 50_000, fmvMinor: 1_000, currency: 'CAD' })).toBeNull();
  });

  it('reads "of your $500 payment, $350 is tax-deductible"', () => {
    const n = { priceMinor: 50_000, fmvMinor: 15_000, deductibleMinor: 35_000, currency: 'USD' };
    expect(taxNoticeText(n, 'en').text).toBe(
      'Of your $500.00 payment, $350.00 is tax-deductible. The estimated fair-market value of the goods and services you receive is $150.00.',
    );
    expect(taxNoticeText(n, 'xx').title).toBe('Tax-deductible amount');
    expect(taxNoticeText(n, 'ar').text).toContain('من دفعتك');
  });
});

describe('EINs, years and numbers', () => {
  it('normalizes EINs and refuses impossible ones', () => {
    expect(normalizeEin('123456789')).toBe('12-3456789');
    expect(normalizeEin(' 12-345 6789 ')).toBe('12-3456789');
    expect(normalizeEin('12345678')).toBeNull();
    expect(normalizeEin('00-1234567')).toBeNull();
    expect(normalizeEin('07-1234567')).toBeNull();
    expect(normalizeEin('ab-cdefghi')).toBeNull();
  });

  it('tax years follow the org timezone', () => {
    const at = new Date('2028-01-01T03:00:00Z');
    expect(taxYearOf(at, 'UTC')).toBe(2028);
    expect(taxYearOf(at, 'America/Los_Angeles')).toBe(2027);
    expect(statementYearDue(at, 'UTC')).toBe(2027);
    expect(statementYearDue(at, 'America/Los_Angeles')).toBe(2026);
  });

  it('statements total exactly', () => {
    expect(
      statementTotals([
        { amountMinor: 50_000, fmvMinor: 15_000, deductibleMinor: 35_000 },
        { amountMinor: 10_000, fmvMinor: 0, deductibleMinor: 10_000 },
        { amountMinor: 3_333, fmvMinor: 1_111, deductibleMinor: 2_222 },
      ]),
    ).toEqual({ count: 3, amountMinor: 63_333, fmvMinor: 16_111, deductibleMinor: 47_222 });
    expect(formatReceiptNumber(7)).toBe('R-00007');
  });
});

describe('the IRS exempt-organization list (recorded fixture)', () => {
  it('parses the EO BMF layout', () => {
    const rows = parseEoBmf(
      '"EIN","NAME","CITY","STATE","SUBSECTION","DEDUCTIBILITY","STATUS"\n"123456789","A ""B"" C","X","IL","03","1","01"\n\n',
    );
    expect(rows).toEqual([
      {
        ein: '12-3456789',
        name: 'A "B" C',
        city: 'X',
        state: 'IL',
        subsection: '03',
        deductibility: '1',
        status: '01',
      },
    ]);
    expect(() => parseEoBmf('"EIN","NAME"\n')).toThrow(/missing column/);
  });

  it('eligible: a 501(c)(3), deductible, in force; everything else says why not', async () => {
    const irs = recordedExemptOrgLookup();
    expect(irs.source).toBe('fixture');
    expect(exemptProblem(await irs.lookup('23-4567891'))).toBeNull();
    expect(exemptProblem(await irs.lookup('34-5678912'))).toBeNull();
    expect(exemptProblem(await irs.lookup('45-6789123'))).toBe('not_501c3');
    expect(exemptProblem(await irs.lookup('56-7891234'))).toBe('not_deductible');
    expect(exemptProblem(await irs.lookup('99-9999999'))).toBe('not_listed');
    const listed = await irs.lookup('23-4567891');
    if (!listed) throw new Error('fixture');
    expect(exemptProblem({ ...listed, status: '20' })).toBe('not_in_force');
  });
});

describe('the legal-copy template', () => {
  it('every locale has every string, with the same placeholders as English', () => {
    const holes = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    const flat = (c: object, prefix = ''): [string, string][] =>
      Object.entries(c).flatMap(([k, v]) =>
        typeof v === 'string'
          ? [[`${prefix}${k}`, v] as [string, string]]
          : flat(v as object, `${prefix}${k}.`),
      );
    const en = new Map(flat(RECEIPT_COPY.en));
    for (const [locale, copy] of Object.entries(RECEIPT_COPY)) {
      const mine = new Map(flat(copy));
      expect([...mine.keys()].sort(), locale).toEqual([...en.keys()].sort());
      for (const [k, v] of en) expect(holes(mine.get(k) ?? ''), `${locale} ${k}`).toEqual(holes(v));
    }
  });

  it('the email body carries the rows and statements', () => {
    const body = receiptEmailBody(
      {
        number: 3,
        deductible: true,
        donorName: 'Ada',
        currency: 'USD',
        amountMinor: 10_000,
        fmvMinor: 0,
        deductibleMinor: 10_000,
        goods: null,
        charityName: 'Harbor Arts Alliance',
        charityEin: '23-4567891',
        sponsorName: null,
        sponsorEin: null,
        charityAddress: null,
        eventName: 'Gala',
        paidAt: new Date('2027-03-01T12:00:00Z'),
        timeZone: 'UTC',
      },
      'en',
    );
    expect(body).toContain('Receipt number: R-00003');
    expect(body).toContain('No goods or services were provided in exchange for this contribution.');
  });

  it('a fiscally sponsored project prints the sponsor and its EIN', () => {
    const body = receiptEmailBody(
      {
        number: 4,
        deductible: true,
        donorName: 'Ada',
        currency: 'USD',
        amountMinor: 10_000,
        fmvMinor: 0,
        deductibleMinor: 10_000,
        goods: null,
        charityName: 'Pier Kids Project',
        charityEin: '12-3456789',
        sponsorName: 'Good Cause Fiscal Sponsor Inc',
        sponsorEin: '34-5678912',
        charityAddress: null,
        eventName: 'Gala',
        paidAt: new Date('2027-03-01T12:00:00Z'),
        timeZone: 'UTC',
      },
      'en',
    );
    expect(body).toContain('EIN: 34-5678912');
    expect(body).toContain('a fiscally sponsored project of Good Cause Fiscal Sponsor Inc');
  });
});
