import { describe, expect, it } from 'vitest';
import {
  CRM_COLUMNS,
  CRM_LAYOUTS,
  decimalAmount,
  EXPORT_FIELDS,
  type ExportLabels,
  exportHeaders,
  exportRow,
  localDate,
  splitName,
} from '../src/domain/crm.ts';
import {
  eventMovements,
  nextItemStatus,
  payoutShares,
  reconcileDonations,
  reconTotals,
} from '../src/domain/reconcile.ts';
import {
  byDonor,
  byLevel,
  bySource,
  currencyTotals,
  type DonationLine,
  donorKey,
  lineNet,
  type PledgeFact,
  pledgeSummary,
} from '../src/domain/report.ts';
import { DonationReportDto } from '../src/report-dto.ts';

const at = new Date('2026-11-20T03:30:00Z');
const line = (over: Partial<DonationLine> = {}): DonationLine => ({
  id: 'l1',
  source: 'online',
  method: 'card',
  campaignName: 'Fund',
  levelId: null,
  levelName: null,
  donorName: 'Ada Lovelace',
  donorEmail: 'ada@example.test',
  anonymous: false,
  employer: null,
  tributeKind: null,
  tributeName: null,
  paddleNumber: null,
  date: at,
  amountMinor: 10_000,
  feeCoverMinor: 0,
  refundedMinor: 0,
  currency: 'USD',
  orderId: 'o1',
  ...over,
});
const pledge = (over: Partial<PledgeFact> = {}): PledgeFact => ({
  amountMinor: 100_000,
  currency: 'USD',
  levelId: 'gold',
  levelName: 'Gold',
  status: 'open',
  paidBy: null,
  ...over,
});

describe('report lines (M4.8g)', () => {
  it('a line nets its covered fee and its refunds, never below zero', () => {
    expect(lineNet(line({ feeCoverMinor: 320 }))).toBe(10_320);
    expect(lineNet(line({ feeCoverMinor: 320, refundedMinor: 2_000 }))).toBe(8_320);
    expect(lineNet(line({ refundedMinor: 50_000 }))).toBe(0);
  });

  it('per source in a fixed order, per currency; never summing currencies', () => {
    const rows = bySource([
      line({ source: 'ticket', amountMinor: 500 }),
      line({ source: 'qr' }),
      line({ source: 'online', currency: 'EUR' }),
      line({ source: 'online', refundedMinor: 1_000 }),
      line({ source: 'paddle', method: 'check' }),
    ]);
    expect(rows.map((r) => [r.source, r.currency, r.count, r.netMinor])).toEqual([
      ['online', 'EUR', 1, 10_000],
      ['online', 'USD', 1, 9_000],
      ['qr', 'USD', 1, 10_000],
      ['paddle', 'USD', 1, 10_000],
      ['ticket', 'USD', 1, 500],
    ]);
  });

  it('per level: gifts given at it and pledges called at it, never a paddle payment twice; own amounts last', () => {
    const rows = byLevel(
      [
        line({ levelId: 'gold', levelName: 'Gold', amountMinor: 100_000 }),
        line({ source: 'paddle', levelId: 'gold', levelName: 'Gold', amountMinor: 100_000 }),
        line({ amountMinor: 3_000 }),
      ],
      [pledge(), pledge({ levelId: 'silver', levelName: 'Silver', amountMinor: 25_000 })],
    );
    expect(rows).toEqual([
      {
        levelId: 'gold',
        name: 'Gold',
        currency: 'USD',
        giftCount: 1,
        giftNetMinor: 100_000,
        pledgeCount: 1,
        pledgedMinor: 100_000,
      },
      {
        levelId: 'silver',
        name: 'Silver',
        currency: 'USD',
        giftCount: 0,
        giftNetMinor: 0,
        pledgeCount: 1,
        pledgedMinor: 25_000,
      },
      {
        levelId: null,
        name: null,
        currency: 'USD',
        giftCount: 1,
        giftNetMinor: 3_000,
        pledgeCount: 0,
        pledgedMinor: 0,
      },
    ]);
  });

  it('per donor by email (case-insensitive), largest first; anonymous on any gift flags the donor', () => {
    const rows = byDonor([
      line({ donorEmail: 'ADA@example.test', amountMinor: 1_000 }),
      line({ donorEmail: 'ada@example.test', amountMinor: 2_000, anonymous: true }),
      line({ donorName: 'Ben', donorEmail: 'ben@example.test', amountMinor: 5_000 }),
      line({ donorName: 'Check Payer', donorEmail: null, method: 'check', amountMinor: 500 }),
    ]);
    expect(rows.map((r) => [r.name, r.count, r.netMinor, r.anonymous])).toEqual([
      ['Ben', 1, 5_000, false],
      ['Ada Lovelace', 2, 3_000, true],
      ['Check Payer', 1, 500, false],
    ]);
    expect(donorKey({ donorEmail: null, donorName: ' Check Payer ' })).toBe('n:check payer');
  });

  it('pledged vs collected (card, link, offline) vs written off vs open', () => {
    expect(
      pledgeSummary([
        pledge({ status: 'paid', paidBy: 'card' }),
        pledge({ status: 'paid', paidBy: 'link', amountMinor: 25_000 }),
        pledge({ status: 'paid_offline', amountMinor: 25_000 }),
        pledge({ status: 'written_off', amountMinor: 10_000 }),
        pledge({ status: 'invoiced' }),
        pledge({ status: 'scheduled', amountMinor: 5_000 }),
      ]),
    ).toEqual([
      {
        currency: 'USD',
        count: 6,
        pledgedMinor: 265_000,
        cardMinor: 100_000,
        linkMinor: 25_000,
        offlineMinor: 25_000,
        writtenOffMinor: 10_000,
        openMinor: 105_000,
      },
    ]);
  });

  it('currency totals: card money on the account, offline and ticket donations apart; matches but not cancelled ones', () => {
    const [t] = currencyTotals(
      [
        line({ feeCoverMinor: 320, refundedMinor: 1_000 }),
        line({ source: 'paddle', method: 'check', amountMinor: 25_000 }),
        line({ source: 'ticket', amountMinor: 5_000 }),
      ],
      [
        pledge({ status: 'paid_offline', amountMinor: 25_000 }),
        pledge({ status: 'written_off', amountMinor: 5_000 }),
      ],
      [
        {
          id: 'm1',
          sponsorName: 'S',
          publicName: null,
          campaignName: 'Fund',
          ratioPercent: 100,
          capMinor: 1,
          currency: 'USD',
          status: 'active',
          matchedMinor: 700,
          giftCount: 1,
        },
        {
          id: 'm2',
          sponsorName: 'S',
          publicName: null,
          campaignName: 'Fund',
          ratioPercent: 100,
          capMinor: 1,
          currency: 'USD',
          status: 'cancelled',
          matchedMinor: 900,
          giftCount: 1,
        },
      ],
    );
    expect(t).toEqual({
      currency: 'USD',
      onlineNetMinor: 9_320,
      offlineMinor: 25_000,
      ticketMinor: 5_000,
      raisedMinor: 39_320,
      feeCoverMinor: 320,
      refundedMinor: 1_000,
      pledgedMinor: 30_000,
      pledgeCollectedMinor: 25_000,
      writtenOffMinor: 5_000,
      pledgeOpenMinor: 0,
      matchedMinor: 700,
      lineCount: 3,
      donorCount: 1,
    });
  });
});

describe('reconciliation (M4.8g)', () => {
  it('sums each side per reference and currency and lists only what differs', () => {
    const diffs = reconcileDonations(
      [
        { reference: 'order:a', currency: 'USD', amountMinor: 10_000 },
        { reference: 'order:b', currency: 'USD', amountMinor: 5_000 },
        { reference: 'refund:r', currency: 'USD', amountMinor: -1_000 },
        { reference: 'order:c', currency: 'USD', amountMinor: 2_000 },
      ],
      [
        { reference: 'order:a', currency: 'USD', amountMinor: 10_000 },
        { reference: 'order:b', currency: 'USD', amountMinor: 4_000 },
        { reference: 'order:b', currency: 'USD', amountMinor: 1_000 },
        { reference: 'refund:r', currency: 'USD', amountMinor: -900 },
        { reference: 'order:d', currency: 'USD', amountMinor: 700 },
      ],
    );
    expect(diffs).toEqual([
      {
        kind: 'missing_at_provider',
        reference: 'order:c',
        currency: 'USD',
        ledgerMinor: 2_000,
        providerMinor: 0,
      },
      {
        kind: 'missing_in_ledger',
        reference: 'order:d',
        currency: 'USD',
        ledgerMinor: 0,
        providerMinor: 700,
      },
      {
        kind: 'amount_mismatch',
        reference: 'refund:r',
        currency: 'USD',
        ledgerMinor: -1_000,
        providerMinor: -900,
      },
    ]);
  });

  it('keeps only the event’s charges and refunds; totals with fees and what is not paid out yet', () => {
    const txns = [
      {
        kind: 'charge',
        reference: 'order:a',
        amountMinor: 10_000,
        feeMinor: 250,
        payoutId: 'po1',
        currency: 'USD',
      },
      {
        kind: 'refund',
        reference: 'refund:r',
        amountMinor: -1_000,
        feeMinor: 0,
        payoutId: null,
        currency: 'USD',
      },
      {
        kind: 'charge',
        reference: 'order:other-event',
        amountMinor: 9_999,
        feeMinor: 1,
        payoutId: 'po1',
        currency: 'USD',
      },
      { kind: 'payout', reference: null, amountMinor: -9_000, feeMinor: 0, payoutId: null, currency: 'USD' },
    ];
    const ours = eventMovements(txns, new Set(['order:a', 'refund:r']));
    expect(ours.map((t) => t.reference)).toEqual(['order:a', 'refund:r']);
    expect(reconTotals([{ reference: 'order:a', currency: 'USD', amountMinor: 10_000 }], ours)).toEqual([
      {
        currency: 'USD',
        ledgerMinor: 10_000,
        providerMinor: 9_000,
        feeMinor: 250,
        unpaidOutMinor: -1_000,
        unpaidOutCount: 1,
      },
    ]);
    expect(payoutShares(ours)).toEqual(new Map([['po1', { grossMinor: 10_000, feeMinor: 250, count: 1 }]]));
  });

  it('a difference opens, re-opens when its amounts change, stays resolved when they don’t, clears when gone', () => {
    expect(nextItemStatus(null, { ledgerMinor: 1, providerMinor: 2 })).toBe('open');
    expect(nextItemStatus({ status: 'open', ledgerMinor: 1, providerMinor: 2 }, null)).toBe('cleared');
    expect(nextItemStatus({ status: 'resolved', ledgerMinor: 1, providerMinor: 2 }, null)).toBe('resolved');
    expect(
      nextItemStatus(
        { status: 'resolved', ledgerMinor: 1, providerMinor: 2 },
        { ledgerMinor: 1, providerMinor: 2 },
      ),
    ).toBe('resolved');
    expect(
      nextItemStatus(
        { status: 'resolved', ledgerMinor: 1, providerMinor: 2 },
        { ledgerMinor: 1, providerMinor: 3 },
      ),
    ).toBe('open');
    expect(
      nextItemStatus(
        { status: 'cleared', ledgerMinor: 1, providerMinor: 2 },
        { ledgerMinor: 1, providerMinor: 2 },
      ),
    ).toBe('open');
    expect(nextItemStatus(null, null)).toBeNull();
  });
});

const LABELS: ExportLabels = {
  headers: Object.fromEntries(EXPORT_FIELDS.map((f) => [f, `h:${f}`])) as ExportLabels['headers'],
  yes: 'Sí',
  no: 'No',
  sources: { online: 'En línea', qr: 'QR', paddle: 'Paleta', ticket: 'Entrada' },
  methods: {
    card: 'Tarjeta',
    check: 'Cheque',
    wire: 'Transferencia',
    stock: 'Acciones',
    daf: 'DAF',
    cash: 'Efectivo',
    other: 'Otro',
  },
};

describe('donor CRM exports (M4.8g)', () => {
  it('amounts as plain decimals in the currency’s minor unit; names split for CRMs; dates in the event’s zone', () => {
    expect(decimalAmount(123_450, 'USD')).toBe('1234.50');
    expect(decimalAmount(5, 'USD')).toBe('0.05');
    expect(decimalAmount(-1_000, 'USD')).toBe('-10.00');
    expect(decimalAmount(5_000, 'JPY')).toBe('5000');
    expect(decimalAmount(1_234, 'KWD')).toBe('1.234');
    expect(splitName('Ada King Lovelace')).toEqual({ first: 'Ada King', last: 'Lovelace' });
    expect(splitName('  Cher ')).toEqual({ first: '', last: 'Cher' });
    expect(localDate(at, 'America/Chicago')).toBe('2026-11-19');
    expect(localDate(at, 'Asia/Tokyo')).toBe('2026-11-20');
  });

  it('every layout keeps the anonymous flag; the generic one speaks the requester’s language', () => {
    for (const layout of CRM_LAYOUTS) expect(CRM_COLUMNS[layout].some(([f]) => f === 'anonymous')).toBe(true);
    const ctx = { timeZone: 'America/Chicago', labels: LABELS };
    const l = line({
      anonymous: true,
      feeCoverMinor: 320,
      refundedMinor: 1_000,
      employer: 'Acme',
      tributeName: 'Lu',
      source: 'qr',
    });
    expect(exportHeaders('generic', LABELS)[0]).toBe('h:date');
    const g = exportRow('generic', l, ctx);
    expect(g).toEqual([
      '2026-11-19',
      'Ada Lovelace',
      'ada@example.test',
      'Sí',
      '93.20',
      '100.00',
      '3.20',
      '10.00',
      'USD',
      'Fund',
      '',
      'QR',
      'Tarjeta',
      'Acme',
      'Lu',
      '',
      'l1',
    ]);
    const npsp = exportRow('salesforce_npsp', l, ctx);
    expect(exportHeaders('salesforce_npsp', LABELS)).toContain('Contact1 First Name');
    expect(npsp.slice(0, 5)).toEqual(['Ada', 'Lovelace', 'ada@example.test', '93.20', '2026-11-19']);
    expect(npsp).toContain('TRUE');
    expect(
      exportRow('little_green_light', line({ method: 'daf', source: 'paddle', paddleNumber: 7 }), ctx),
    ).toContain('Donor-Advised Fund');
  });
});

describe('report payload (allowlist)', () => {
  it('carries no provider or payment identifiers and no tribute notes', () => {
    const keys = JSON.stringify(Object.keys(DonationReportDto.shape));
    const donorKeys = Object.keys(DonationReportDto.shape.byDonor.element.shape);
    expect(donorKeys).toEqual(['key', 'name', 'email', 'anonymous', 'currency', 'count', 'netMinor']);
    expect(keys).not.toMatch(/order|payment|account|note/i);
  });
});
