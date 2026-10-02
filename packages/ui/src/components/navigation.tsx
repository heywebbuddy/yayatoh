import type { ComponentProps, ElementType, ReactNode } from 'react';
import { cx } from '../cx.ts';
import { Kbd } from './labels.tsx';

/**
 * Sidebar row (ADR 0022, floating dark sidebar): an icon tile, the label and an optional badge.
 * The active row is a lighter band with a white (dark mode: violet) icon tile.
 */
export function navItemClass(active: boolean): string {
  return cx(
    'group/nav flex min-h-11 items-center gap-3 rounded-control py-1.5 ps-1.5 pe-2.5 text-body transition-colors duration-150',
    active
      ? 'bg-side-row font-bold text-side-strong'
      : 'font-semibold text-side-ink hover:bg-side-hover hover:text-side-strong',
  );
}

/** The 34 px icon tile inside a sidebar row. */
export function navTileClass(active: boolean): string {
  return cx(
    'flex size-[34px] shrink-0 items-center justify-center rounded-[11px] [&_svg]:size-[17px]',
    active ? 'bg-side-tile-on text-side-tile-on-ink' : 'bg-side-tile',
  );
}

/** A labelled group of sidebar rows ("MENU", "ACCOUNT"). */
export function NavSection({ label, children, id }: { label: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p id={id} className="px-2.5 pb-1.5 text-label tracking-[0.12em] text-side-label uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Segmented tab row (event workspace, filters). Wrap links or buttons styled by `tabClass`. */
export function Tabs({
  label,
  children,
  className,
  as: As = 'nav',
}: {
  label: string;
  children: ReactNode;
  className?: string;
  as?: 'nav' | 'div';
}) {
  return (
    <As
      aria-label={label}
      {...(As === 'div' ? { role: 'group' } : {})}
      className={cx(
        'flex max-w-full gap-1.5 overflow-x-auto rounded-tile border border-line bg-surface p-1.5 glass [scrollbar-width:none]',
        className,
      )}
    >
      {children}
    </As>
  );
}

export function tabClass(active: boolean): string {
  return cx(
    'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[13px] px-4 text-body whitespace-nowrap transition-colors duration-150',
    active
      ? 'bg-tab-on font-extrabold text-white dark:elevation-primary'
      : 'font-bold text-ink-2 hover:bg-surface-3 hover:text-ink',
  );
}

/** The count inside a tab ("Guests 186"). */
export function TabCount({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={cx(
        'rounded-[7px] px-1.5 py-0.5 text-caption font-bold tabular-nums',
        active ? 'bg-white/20' : 'bg-surface-3 text-ink-2',
      )}
    >
      {children}
    </span>
  );
}

/** Filter chips ("All 186", "Attending 142"): pressed = dark tag colour. */
export function filterChipClass(pressed: boolean): string {
  return cx(
    'inline-flex min-h-9 items-center gap-1.5 rounded-pill border px-3 text-[13px] font-bold whitespace-nowrap transition-colors duration-150',
    pressed
      ? 'border-transparent bg-tag text-tag-ink'
      : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
  );
}

export interface Crumb {
  readonly label: ReactNode;
  readonly href?: string;
}

/** Breadcrumb trail; a last item without a link is the current page. */
export function Breadcrumb({
  items,
  label,
  link: LinkC = 'a',
}: {
  items: readonly Crumb[];
  /** "Breadcrumb", localized. */
  label: string;
  link?: ElementType;
}) {
  return (
    <nav aria-label={label}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-[13px] font-semibold text-ink-2">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a trail is a fixed sequence; labels may repeat
              key={`${i}-${typeof c.label === 'string' ? c.label : ''}`}
              className="flex items-center gap-1.5"
            >
              {c.href ? (
                <LinkC
                  href={c.href}
                  className="rounded-tag hover:text-ink hover:underline underline-offset-2"
                >
                  {c.label}
                </LinkC>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'text-ink' : undefined}>
                  {c.label}
                </span>
              )}
              {last ? null : (
                <span aria-hidden="true" className="text-ink-3 rtl:-scale-x-100">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Previous / page n of m / next. Links are omitted (rendered disabled) at the ends. */
export function Pagination({
  label,
  previous,
  next,
  status,
  link: LinkC = 'a',
}: {
  label: string;
  previous: { href: string | null; label: string };
  next: { href: string | null; label: string };
  status?: ReactNode;
  link?: ElementType;
}) {
  const cls =
    'inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line bg-surface px-4 text-body font-bold text-ink transition-colors duration-150 hover:border-line-strong hover:bg-surface-2';
  const off = 'inline-flex min-h-10 items-center rounded-control px-4 text-body font-bold text-ink-3';
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      {previous.href ? (
        <LinkC href={previous.href} className={cls} rel="prev">
          <span aria-hidden="true" className="rtl:-scale-x-100">
            ‹
          </span>
          {previous.label}
        </LinkC>
      ) : (
        <span className={off} aria-disabled="true">
          {previous.label}
        </span>
      )}
      {status ? <span className="text-[13px] text-ink-2 tabular-nums">{status}</span> : null}
      {next.href ? (
        <LinkC href={next.href} className={cls} rel="next">
          {next.label}
          <span aria-hidden="true" className="rtl:-scale-x-100">
            ›
          </span>
        </LinkC>
      ) : (
        <span className={off} aria-disabled="true">
          {next.label}
        </span>
      )}
    </nav>
  );
}

/** Search field with a visually hidden label, a magnifier and an optional shortcut hint. */
export function SearchPill({
  label,
  shortcut,
  className,
  ...rest
}: ComponentProps<'input'> & { label: string; shortcut?: string }) {
  const id = rest.id ?? 'global-search';
  return (
    <div
      className={cx(
        'flex h-11 items-center gap-2.5 rounded-[16px] border border-line bg-surface px-3.5 text-ink-2 glass transition-colors duration-150 hover:border-line-strong focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[18px] shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        id={id}
        type="search"
        className="min-w-0 flex-1 bg-transparent text-body font-medium text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
        {...rest}
      />
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </div>
  );
}
