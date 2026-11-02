'use client';

import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

/**
 * One agenda row: the time range (monospace, accent) above the bold session title. A row with
 * details is a disclosure (button with `aria-expanded`/`aria-controls` and a +/− at the end);
 * a row without (a break) is plain.
 */
export function AgendaRow({
  time,
  title,
  meta,
  children,
  expandLabel,
}: {
  time: string;
  title: string;
  meta?: string | null;
  children?: ReactNode;
  /** "Show details for {title}" for screen readers. */
  expandLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const head = (
    <span className="flex min-w-0 flex-col gap-1 text-start">
      <span className="ev-time font-mono text-[13px] font-bold tracking-wide tabular-nums">{time}</span>
      <span className="text-[length:calc(18px*var(--ev-scale,1))] leading-snug font-extrabold text-ink">
        {title}
      </span>
      {meta ? <span className="text-caption text-ink-2">{meta}</span> : null}
    </span>
  );
  if (!children) return <li className="ev-agenda-row px-5 py-4 md:px-6">{head}</li>;
  return (
    <li className="ev-agenda-row">
      <h3 className="m-0 text-[length:inherit] font-[inherit]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-[inherit] px-5 py-4 focus-visible:outline-2 focus-visible:outline-focus md:px-6"
        >
          {head}
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ev-accent,var(--color-primary))] text-[var(--ev-on-accent,var(--color-on-primary))]"
          >
            {open ? (
              <Minus className="size-4" strokeWidth={2.6} />
            ) : (
              <Plus className="size-4" strokeWidth={2.6} />
            )}
          </span>
          <span className="sr-only">{expandLabel}</span>
        </button>
      </h3>
      <div id={id} hidden={!open} className="px-5 pb-5 text-body text-ink-2 md:px-6">
        {children}
      </div>
    </li>
  );
}
