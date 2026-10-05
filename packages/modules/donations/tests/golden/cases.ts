import { type ReceiptDocInput, receiptHtml, type StatementDocInput, statementHtml } from '../../src/index.ts';

/**
 * Golden receipt documents (M4.8b): the acceptance cases of P4-11 in English and Arabic. A $500
 * gala ticket with a $150 fair-market value ($350 deductible), a $100 gift with nothing in return,
 * a plain receipt of an unverified org, and a year-end statement that totals two receipts.
 */
export const LANGS = ['en', 'ar'] as const;

const charity = {
  charityName: 'Harbor Arts Alliance',
  charityEin: '23-4567891',
  sponsorName: null,
  sponsorEin: null,
  charityAddress: '1 Pier Way, Boston, MA 02110',
};

const ticket: ReceiptDocInput = {
  ...charity,
  number: 7,
  deductible: true,
  donorName: 'Ada Lovelace',
  currency: 'USD',
  amountMinor: 50_000,
  fmvMinor: 15_000,
  deductibleMinor: 35_000,
  goods: '1 × Gala dinner (Dinner and entertainment)',
  eventName: 'Harbor Arts Gala',
  paidAt: new Date('2027-05-15T02:30:00Z'),
  timeZone: 'America/New_York',
};

const gift: ReceiptDocInput = {
  ...ticket,
  number: 8,
  amountMinor: 10_000,
  fmvMinor: 0,
  deductibleMinor: 10_000,
  goods: null,
};

const plain: ReceiptDocInput = {
  ...gift,
  number: 9,
  deductible: false,
  deductibleMinor: 0,
  charityEin: null,
  charityAddress: null,
};

const statement: StatementDocInput = {
  ...charity,
  charityEin: '23-4567891',
  taxYear: 2027,
  donorName: 'Ada Lovelace',
  currency: 'USD',
  amountMinor: 60_000,
  fmvMinor: 15_000,
  deductibleMinor: 45_000,
  timeZone: 'America/New_York',
  lines: [
    {
      number: 7,
      paidAt: ticket.paidAt,
      eventName: 'Harbor Arts Gala',
      amountMinor: 50_000,
      fmvMinor: 15_000,
      deductibleMinor: 35_000,
    },
    {
      number: 8,
      paidAt: new Date('2027-12-31T23:59:00-05:00'),
      eventName: 'Harbor Arts Gala',
      amountMinor: 10_000,
      fmvMinor: 0,
      deductibleMinor: 10_000,
    },
  ],
};

export const GOLDEN: Record<string, (lang: string) => string> = {
  'receipt-ticket': (l) => receiptHtml(ticket, l),
  'receipt-gift': (l) => receiptHtml(gift, l),
  'receipt-plain': (l) => receiptHtml(plain, l),
  statement: (l) => statementHtml(statement, l),
};
