import { defineSerializer } from '@yayatoh/contracts';
import { csvRow } from '@yayatoh/csv';
import { z } from 'zod';
import type { ExploreDto } from './explore.ts';

/**
 * The explorer's CSV export (M6.2b): one line per row of the allowlisted explorer DTO through an
 * explicit row serializer (the dimension's label, the currency, the value), then the total.
 * Money is written in major units with the currency's own decimals; attributed orders with two
 * decimals (basis points of an order); counts as whole numbers. Cells are formula-safe (`csvRow`).
 */
export const ExploreCsvRow = z.strictObject({
  dimension: z.string(),
  currency: z.string(),
  value: z.string(),
});
export type ExploreCsvRow = z.infer<typeof ExploreCsvRow>;
export const exploreCsvSerializer = defineSerializer('analytics.exploreCsvRow', ExploreCsvRow);
export const EXPLORE_CSV_COLUMNS = ['dimension', 'currency', 'value'] as const satisfies readonly (keyof ExploreCsvRow)[];
export type ExploreCsvColumn = (typeof EXPLORE_CSV_COLUMNS)[number];

/** Decimals of a currency's minor unit (USD 2, JPY 0, KWD 3). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** A whole number of `digits`-decimal units as a plain decimal string (no float rounding). */
export function decimalOf(value: number, digits: number): string {
  if (digits === 0) return String(value);
  const neg = value < 0;
  const s = String(Math.abs(value)).padStart(digits + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** A value of the DTO in its unit, as written to the CSV. */
export function csvValue(dto: Pick<ExploreDto, 'unit'>, value: number, currency: string | null): string {
  if (dto.unit === 'order_bps') return decimalOf(value, 4).replace(/(\.\d{2})\d{2}$/, '$1');
  if (dto.unit === 'minor') return decimalOf(value, currencyDigits(currency ?? 'USD'));
  return String(value);
}

export function exploreCsv(
  dto: ExploreDto,
  headers: Readonly<Record<ExploreCsvColumn, string>>,
  /** The dimension's label for each row (the page's wording: dates, names, "None", the total). */
  labelOf: (row: ExploreDto['rows'][number]) => string,
  totalLabel: string,
): string {
  let out = `﻿${csvRow(EXPLORE_CSV_COLUMNS.map((c) => headers[c]))}`;
  const line = (dimension: string, currency: string | null, value: number) => {
    const r = exploreCsvSerializer.serialize({
      dimension,
      currency: currency ?? '',
      value: csvValue(dto, value, currency),
    });
    return csvRow(EXPLORE_CSV_COLUMNS.map((c) => r[c]));
  };
  for (const row of dto.rows) out += line(labelOf(row), row.currency, row.value);
  for (const t of dto.totals) out += line(totalLabel, t.currency, t.value);
  return out;
}
