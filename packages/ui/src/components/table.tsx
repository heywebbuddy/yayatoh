import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'start' | 'end';
  /** Codes (ticket codes, references) use the mono face; numbers are tabular in every column. */
  mono?: boolean;
}

export interface TableProps<Row> {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  empty?: ReactNode;
  captionHidden?: boolean;
  /** comfortable (default) or compact rows. */
  density?: 'comfortable' | 'compact';
  /**
   * Selectable rows: a checkbox per row named `name` with the row key as its value (forms read the
   * selection with `formData.getAll(name)`). `label` names each checkbox for assistive tech.
   */
  select?: {
    name: string;
    /** The checkbox column's header for assistive tech, e.g. "Select". */
    header: string;
    label: (row: Row) => string;
    selected?: (row: Row) => boolean;
    form?: string;
  };
  /** On phones, show each row as a card (label: value lines) instead of a wide scroller. */
  stackOnPhone?: boolean;
  /** Header stays visible while the table scrolls inside a tall container. */
  stickyHeader?: boolean;
}

/**
 * Data table (ADR 0022): sticky header, row hover, two densities, optional row selection and a
 * card layout on phones. The scroller is focusable so keyboard users can scroll wide tables.
 */
export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  captionHidden = true,
  density = 'comfortable',
  select,
  stackOnPhone = false,
  stickyHeader = true,
}: TableProps<Row>) {
  const pad = density === 'compact' ? 'px-3 py-2' : 'px-4 py-3';
  const stack = stackOnPhone
    ? 'max-sm:block max-sm:[&_thead]:sr-only max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_tr]:border-b max-sm:[&_tr]:border-line max-sm:[&_tr]:py-2 max-sm:[&_td]:flex max-sm:[&_td]:justify-between max-sm:[&_td]:gap-4 max-sm:[&_td]:py-1.5 max-sm:[&_td]:text-end max-sm:[&_td]:before:text-start max-sm:[&_td]:before:text-caption max-sm:[&_td]:before:font-bold max-sm:[&_td]:before:text-ink-2 max-sm:[&_td]:before:content-[attr(data-label)]'
    : '';
  return (
    <section
      aria-label={caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
      tabIndex={0}
      // `relative`: absolutely positioned content (sr-only labels) is clipped by the scroller too.
      className="relative overflow-x-auto rounded-card border border-line bg-surface elevation-card glass"
    >
      <table className={cx('w-full border-collapse text-body', !stackOnPhone && 'min-w-[36rem]', stack)}>
        <caption className={captionHidden ? 'sr-only' : 'p-4 pb-2 text-start text-card'}>{caption}</caption>
        {/* A sticky header never takes clicks (it holds no controls) and rows keep a scroll margin
            its height, so a row scrolled into view (focus, find, scripted clicks) is never under it. */}
        <thead className={cx(stickyHeader && 'pointer-events-none sticky top-0 z-[1]')}>
          <tr className="border-b border-line bg-surface-solid/80">
            {select ? (
              <th scope="col" className={cx(pad, 'w-10')}>
                <span className="sr-only">{select.header}</span>
              </th>
            ) : null}
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  pad,
                  'text-label tracking-[0.06em] text-ink-2 uppercase',
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
              <td colSpan={columns.length + (select ? 1 : 0)} className="px-4 py-12 text-center text-ink-2">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={cx(
                    'border-b border-line transition-colors duration-150 last:border-0 hover:bg-surface-2 has-[input[type=checkbox]:checked]:bg-primary-soft',
                    stickyHeader && 'scroll-mt-12',
                  )}
                >
                  {select ? (
                    <td className={pad}>
                      <input
                        type="checkbox"
                        name={select.name}
                        value={key}
                        form={select.form}
                        defaultChecked={select.selected?.(row)}
                        aria-label={select.label(row)}
                        className="size-[18px] cursor-pointer accent-primary"
                      />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      data-label={stackOnPhone ? c.header : undefined}
                      className={cx(
                        pad,
                        'tabular-nums',
                        c.align === 'end' ? 'text-end' : 'text-start',
                        c.mono && 'font-mono text-caption',
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
