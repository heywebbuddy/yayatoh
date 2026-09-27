import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
  /** Numbers and codes use the mono face. */
  mono?: boolean;
}

export interface TableProps<Row> {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  empty?: ReactNode;
  captionHidden?: boolean;
}

export function Table<Row>({ caption, columns, rows, rowKey, empty, captionHidden = true }: TableProps<Row>) {
  return (
    <div className="overflow-x-auto rounded-card border border-zinc-200 bg-white">
      <table className="w-full border-collapse text-body">
        <caption className={captionHidden ? 'sr-only' : 'p-4 text-start text-section'}>{caption}</caption>
        <thead>
          <tr className="border-b border-zinc-200">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  'px-4 py-3 font-mono text-label font-normal uppercase text-zinc-500',
                  c.align === 'end' ? 'text-end' : 'text-start',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-zinc-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      'px-4 py-3',
                      c.align === 'end' ? 'text-end' : 'text-start',
                      c.mono && 'font-mono text-caption tabular-nums',
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
