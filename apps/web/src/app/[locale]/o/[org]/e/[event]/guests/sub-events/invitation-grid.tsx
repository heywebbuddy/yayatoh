'use client';

import type { InviteTarget } from '@yayatoh/guests';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useRef, useState, useTransition } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

/** One checkbox of the grid: what it shows and what toggling it changes. */
export interface GridCell {
  readonly label: string;
  /** "Luis Garcia · Reception", for the saved message. */
  readonly what: string;
  /** `some` = a whole party or sub-event where only part is invited. */
  readonly state: 'none' | 'some' | 'all';
  /** Why it can't be toggled here (a plus-one, an "everyone invited" sub-event, read-only). */
  readonly locked: string | null;
  readonly change: { subEventIds: string[]; target: InviteTarget } | null;
  /** The recorded answer, for a guest's cell. */
  readonly response?: string | null;
}

export interface GridRow {
  readonly key: string;
  readonly header: string;
  /** `party` rows head a household; `guest` rows are indented under it; `all` is the first row. */
  readonly level: 'all' | 'party' | 'guest' | 'plus_one';
  readonly cells: readonly GridCell[];
}

/**
 * The invitation matrix (M4.1c): guests grouped by party × sub-events, as an ARIA grid. One tab
 * stop; arrow keys move between checkboxes (Home/End: row start/end, Ctrl+Home/End: first/last),
 * Space toggles. The first row toggles a whole sub-event, each party row a whole party. Every
 * change is a `guests.setInvitations` command; the page re-reads the server's state after it.
 */
export function InvitationGrid({
  columns,
  rows,
  caption,
  toggle,
}: {
  columns: readonly { id: string; name: string; detail: string }[];
  rows: readonly GridRow[];
  caption: string;
  toggle: (change: {
    subEventIds: string[];
    target: InviteTarget;
    invited: boolean;
  }) => Promise<{ ok: boolean; code: string | null; reason?: string }>;
}) {
  const t = useTranslations('subEvents');
  const te = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const refs = useRef(new Map<string, HTMLInputElement>());
  const at = (r: number, c: number) => `${r}:${c}`;

  const focus = (r: number, c: number) => {
    const row = Math.max(0, Math.min(rows.length - 1, r));
    const col = Math.max(0, Math.min(columns.length - 1, c));
    setPos([row, col]);
    refs.current.get(at(row, col))?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      // Logical: "next" follows the reading direction (right-to-left in Arabic).
      ArrowRight: document.dir === 'rtl' ? [r, c - 1] : [r, c + 1],
      ArrowLeft: document.dir === 'rtl' ? [r, c + 1] : [r, c - 1],
      Home: e.ctrlKey ? [0, 0] : [r, 0],
      End: e.ctrlKey ? [rows.length - 1, columns.length - 1] : [r, columns.length - 1],
      PageUp: [r - 10, c],
      PageDown: [r + 10, c],
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    focus(next[0], next[1]);
  };

  const onToggle = (cell: GridCell, r: number, c: number) => {
    setPos([r, c]);
    const change = cell.change;
    if (cell.locked || !change || pending) return;
    const invited = cell.state !== 'all';
    start(async () => {
      const res = await toggle({ ...change, invited });
      if (res.ok) {
        setMessage({
          tone: 'ok',
          text: invited ? t('invitedNow', { what: cell.what }) : t('uninvitedNow', { what: cell.what }),
        });
        router.refresh();
      } else {
        setMessage({
          tone: 'error',
          text:
            res.reason && t.has(`errors.${res.reason}`)
              ? t(`errors.${res.reason}`)
              : te(errorMessageKey(res.code ?? 'internal')),
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-card border border-zinc-200">
        <table
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the WAI-ARIA data grid pattern (one tab stop, arrow keys) on a real table keeps its row and column headers
          role="grid"
          aria-label={caption}
          aria-busy={pending}
          className="w-full border-collapse text-body"
        >
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky start-0 z-10 bg-white px-3 py-2 text-start text-caption text-zinc-600"
              >
                {t('guestColumn')}
              </th>
              {columns.map((col) => (
                <th key={col.id} scope="col" className="min-w-32 px-3 py-2 text-center align-bottom">
                  <span className="block text-caption font-medium text-zinc-800">{col.name}</span>
                  <span className="block text-caption text-zinc-600">{col.detail}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={row.key}
                data-level={row.level}
                className="border-t border-zinc-100 data-[level=party]:bg-zinc-50"
              >
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-white px-3 py-1.5 text-start font-normal data-[level=party]:bg-zinc-50 data-[level=party]:font-medium data-[level=guest]:ps-6 data-[level=plus_one]:ps-10"
                  data-level={row.level}
                >
                  {row.header}
                </th>
                {row.cells.map((cell, c) => {
                  const active = pos[0] === r && pos[1] === c;
                  return (
                    <td key={columns[c]?.id ?? c} className="px-3 py-1.5 text-center">
                      <span className="inline-flex flex-col items-center gap-0.5">
                        <input
                          type="checkbox"
                          ref={(el) => {
                            if (el) {
                              refs.current.set(at(r, c), el);
                              el.indeterminate = cell.state === 'some';
                            } else refs.current.delete(at(r, c));
                          }}
                          tabIndex={active ? 0 : -1}
                          checked={cell.state === 'all'}
                          aria-checked={cell.state === 'some' ? 'mixed' : cell.state === 'all'}
                          aria-disabled={cell.locked ? true : undefined}
                          aria-label={cell.label}
                          title={cell.locked ?? undefined}
                          onChange={() => onToggle(cell, r, c)}
                          onClick={(e) => {
                            if (cell.locked) e.preventDefault();
                          }}
                          onFocus={() => setPos([r, c])}
                          onKeyDown={(e) => onKey(e, r, c)}
                          className="size-6 cursor-pointer accent-accent-900 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                        />
                        {cell.response ? (
                          <span className="text-caption text-zinc-600">{cell.response}</span>
                        ) : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-zinc-600">{t('gridHelp')}</p>
      <p
        role="status"
        aria-live="polite"
        data-tone={message?.tone}
        className="min-h-6 text-caption text-zinc-700 data-[tone=error]:text-pink-700"
      >
        {pending ? t('saving') : (message?.text ?? '')}
      </p>
    </div>
  );
}
