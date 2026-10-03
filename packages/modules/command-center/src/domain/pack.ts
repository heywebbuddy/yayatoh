import type { WidgetSize } from './widgets.ts';

/**
 * Board packing (U4): the Command Center grid never shows an empty cell. Each widget asks for a
 * span by its size (`sm` 1 column, `md` 2, `lg` 3), capped at the grid's columns. Widgets keep the
 * member's order (the screen-reader and keyboard order is the visual order); when the next widget
 * doesn't fit in what is left of a row, the row's last widget grows to fill it, and the last row
 * is filled the same way. Pure, so the board, its tests and the snapshot checks share it.
 */
export const GRID_COLUMNS = { base: 1, md: 2, xl: 3 } as const;
export type GridBreakpoint = keyof typeof GRID_COLUMNS;

const PREFERRED: Readonly<Record<WidgetSize, number>> = { sm: 1, md: 2, lg: 3 };

/** The span of each item (same order) so that every row of a `columns`-wide grid is full. */
export function packSpans(sizes: readonly WidgetSize[], columns: number): number[] {
  return packWidths(
    sizes.map((s) => PREFERRED[s]),
    columns,
  );
}

/** Same rule for items that ask for a number of columns. */
export function packWidths(wanted: readonly number[], columns: number): number[] {
  const cols = Math.max(1, Math.floor(columns));
  const spans: number[] = [];
  let used = 0;
  const closeRow = () => {
    if (used > 0 && used < cols) spans[spans.length - 1] = (spans[spans.length - 1] as number) + cols - used;
    used = 0;
  };
  for (const w of wanted) {
    const span = Math.min(Math.max(1, Math.floor(w)), cols);
    if (used + span > cols) closeRow();
    spans.push(span);
    used += span;
    if (used === cols) used = 0;
  }
  closeRow();
  return spans;
}

/** Rows of a packed grid (each a list of spans): what the tests and snapshot checks look at. */
export function packedRows(spans: readonly number[], columns: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (const s of spans) {
    if (used + s > columns) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(s);
    used += s;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Spans per breakpoint for a board (`base` is the phone's single column). */
export function boardSpans(sizes: readonly WidgetSize[]): Record<GridBreakpoint, number[]> {
  return {
    base: packSpans(sizes, GRID_COLUMNS.base),
    md: packSpans(sizes, GRID_COLUMNS.md),
    xl: packSpans(sizes, GRID_COLUMNS.xl),
  };
}

/**
 * The KPI row's columns: two on a phone (the last tile spans both when the count is odd), all of
 * them in one row from the tablet width (at most four tiles).
 */
export function kpiSpans(count: number): { base: number[]; md: number[]; mdColumns: number } {
  const ones = Array.from({ length: count }, () => 1);
  return { base: packWidths(ones, Math.min(2, Math.max(1, count))), md: ones, mdColumns: count };
}
