import { csvCell } from '@yayatoh/csv';
import { decimal } from './bookings-export.ts';
import { localStamp } from './format.ts';
import type {
  EventMoneyDto,
  FeesReportDto,
  MoneyOverviewDto,
  PayoutDetailDto,
  PayoutsDashboardDto,
} from './money.ts';

/**
 * CSV exports of the Money dashboards (U5): each an explicit allowlist of columns over the
 * query's DTO (never rows), amounts as decimals in their currency, times in the org's time zone,
 * headers in the reader's language (passed in), cells neutralised against CSV injection.
 */

export const MONEY_CSV_COLUMNS = {
  overview: ['period', 'currency', 'gross', 'refunds', 'fees'],
  events: ['event', 'currency', 'orders', 'tickets', 'gross', 'refunds', 'disputesLost', 'fees', 'net'],
  payouts: ['date', 'status', 'event', 'currency', 'released', 'reserve', 'netted', 'amount'],
  payout: ['date', 'type', 'order', 'buyer', 'currency', 'gross', 'fee', 'organizer'],
  fees: ['date', 'order', 'event', 'currency', 'total', 'fee', 'feeRefunded'],
} as const;

export type MoneyCsvView = keyof typeof MONEY_CSV_COLUMNS;
export type MoneyCsvHeaders<V extends MoneyCsvView> = Record<(typeof MONEY_CSV_COLUMNS)[V][number], string>;

/**
 * A row. Amounts we format ourselves (`-50.00`) are plain numbers, which a spreadsheet cannot run
 * as a formula, so they are written as is; every other cell goes through `csvCell` (a leading
 * `=`, `+`, `-`, `@`… in text is neutralised).
 */
const NUMBER = /^-?\d+(\.\d+)?$/;
const csvRow = (cells: readonly (string | number)[]) =>
  `${cells.map((c) => (typeof c === 'string' && NUMBER.test(c) ? c : csvCell(c))).join(',')}\r\n`;

const head = <V extends MoneyCsvView>(view: V, h: MoneyCsvHeaders<V>) =>
  csvRow(MONEY_CSV_COLUMNS[view].map((c) => h[c as keyof typeof h]));

/** Buckets of the overview chart (one row per bucket and currency). */
export function overviewCsv(o: MoneyOverviewDto, h: MoneyCsvHeaders<'overview'>): string {
  let out = head('overview', h);
  for (const c of o.currencies)
    for (const b of c.buckets)
      out += csvRow([
        b.start,
        c.currency,
        decimal(b.grossMinor, c.currency),
        decimal(b.refundsMinor, c.currency),
        decimal(b.feesMinor, c.currency),
      ]);
  return out;
}

/** Sales by event: counts from the org report, money from `eventMoneyQuery` when allowed. */
export function eventsCsv(
  rows: readonly {
    name: string;
    currency: string;
    orders: number;
    tickets: number;
    grossMinor: number;
    money: EventMoneyDto['events'][number] | null;
  }[],
  h: MoneyCsvHeaders<'events'>,
): string {
  let out = head('events', h);
  for (const r of rows) {
    const m = r.money;
    const amt = (v: number | undefined) => (v === undefined ? '' : decimal(v, r.currency));
    out += csvRow([
      r.name,
      r.currency,
      r.orders,
      r.tickets,
      decimal(r.grossMinor, r.currency),
      amt(m?.refundsMinor),
      amt(m?.disputesLostMinor),
      amt(m?.feesMinor),
      amt(m?.netMinor),
    ]);
  }
  return out;
}

/** Every payout on the timeline: held, pending and past. */
export function payoutsCsv(
  d: PayoutsDashboardDto,
  h: MoneyCsvHeaders<'payouts'>,
  status: (s: 'held' | PayoutsDashboardDto['pending'][number]['status']) => string,
): string {
  const tz = d.timeZone;
  let out = head('payouts', h);
  for (const x of d.held)
    out += csvRow([
      localStamp(x.releaseAt, tz),
      status('held'),
      x.eventName,
      x.currency,
      decimal(x.heldMinor, x.currency),
      decimal(x.reserveMinor, x.currency),
      '',
      decimal(x.expectedMinor, x.currency),
    ]);
  for (const x of d.pending)
    out += csvRow([
      localStamp(x.releasedAt, tz),
      status(x.status),
      x.eventName,
      x.currency,
      decimal(x.releasedMinor, x.currency),
      decimal(x.reserveMinor, x.currency),
      decimal(x.nettedMinor, x.currency),
      decimal(x.amountMinor, x.currency),
    ]);
  for (const x of d.past)
    out += csvRow([
      localStamp(x.transferredAt ?? x.releasedAt, tz),
      status('transferred'),
      x.eventName,
      x.currency,
      decimal(x.releasedMinor, x.currency),
      decimal(x.reserveMinor, x.currency),
      decimal(x.nettedMinor, x.currency),
      decimal(x.amountMinor, x.currency),
    ]);
  return out;
}

/** One payout's lines: its orders and refunds. */
export function payoutCsv(
  p: PayoutDetailDto,
  timeZone: string,
  h: MoneyCsvHeaders<'payout'>,
  kind: (k: 'sale' | 'refund') => string,
): string {
  let out = head('payout', h);
  for (const l of p.lines)
    out += csvRow([
      localStamp(l.occurredAt, timeZone),
      kind(l.kind),
      l.orderRef,
      l.buyerName,
      p.currency,
      decimal(l.grossMinor, p.currency),
      decimal(l.feeMinor, p.currency),
      decimal(l.organizerMinor, p.currency),
    ]);
  return out;
}

/** Fees per order. */
export function feesCsv(f: FeesReportDto, h: MoneyCsvHeaders<'fees'>): string {
  let out = head('fees', h);
  for (const r of f.perOrder)
    out += csvRow([
      localStamp(r.paidAt, f.timeZone),
      r.orderRef,
      r.eventName,
      r.currency,
      decimal(r.totalMinor, r.currency),
      decimal(r.feeMinor, r.currency),
      decimal(r.feeRefundedMinor, r.currency),
    ]);
  return out;
}
