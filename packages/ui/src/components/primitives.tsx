import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';

/** Sidebar item look: thin 400-weight label; the active item is a zinc-100 pill (ADR 0018). */
export function navItemClass(active: boolean): string {
  return cx(
    'flex min-h-8 items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] text-zinc-700 transition-colors',
    active ? 'bg-zinc-100 text-zinc-900' : 'hover:bg-zinc-50',
  );
}

/** Small pill for counts and progress like "7/10". */
export function Chip({ tone = 'accent', children }: { tone?: 'accent' | 'neutral'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'ms-auto rounded-pill px-[7px] py-px font-mono text-[11px]',
        tone === 'accent' ? 'bg-accent-50 text-accent-text' : 'bg-zinc-100 text-zinc-600',
      )}
    >
      {children}
    </span>
  );
}

/** Pill-shaped search field with a visually hidden label. */
export function SearchPill({
  label,
  shortcut,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; shortcut?: string }) {
  const id = rest.id ?? 'global-search';
  return (
    <div
      className={cx(
        'flex h-10 items-center gap-2 rounded-pill border border-zinc-200 bg-white px-3.5 focus-within:border-zinc-900',
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4 shrink-0 stroke-zinc-500"
        fill="none"
        strokeWidth="1.75"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        type="search"
        className="min-w-0 flex-1 bg-transparent text-body text-zinc-900 outline-none placeholder:text-zinc-500"
        {...rest}
      />
      {shortcut ? (
        <kbd className="rounded-md border border-zinc-200 px-1.5 font-mono text-[11px] text-zinc-500">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

export function Avatar({ initials, label, size = 30 }: { initials: string; label: string; size?: number }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[11px] text-white"
    >
      {initials}
    </span>
  );
}

/** Uppercase mono label (11 px, 0.06 em). Use `tone="inverse"` on ink or black surfaces. */
export function Label({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'inverse';
}) {
  return (
    <span
      className={cx(
        'font-mono text-label uppercase',
        tone === 'inverse' ? 'text-white/75' : 'text-zinc-500',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow}
        <h1 className="text-[32px] leading-[1.1] font-light tracking-[-0.04em] md:text-title">{title}</h1>
        {description ? <p className="text-[15px] text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Empty state: every list and page section has one (M1.1). */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-zinc-300 bg-white px-6 py-14 text-center',
        className,
      )}
    >
      <p className="text-section text-zinc-900">{title}</p>
      {description ? <p className="max-w-md text-body text-zinc-500">{description}</p> : null}
      {action}
    </div>
  );
}

/** Loading placeholder with a reduced-motion-safe pulse. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-card bg-zinc-100 motion-reduce:animate-none', className)}
      {...rest}
    />
  );
}

/** Inline alert for problem+json errors mapped to a localized message. */
export function Alert({
  tone = 'danger',
  title,
  children,
}: {
  tone?: 'danger' | 'info';
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex flex-col gap-1 rounded-card border px-4 py-3 text-body',
        tone === 'danger'
          ? 'border-pink-700/30 bg-pink-50 text-pink-700'
          : 'border-zinc-200 bg-white text-zinc-700',
      )}
    >
      <p className="font-medium">{title}</p>
      {children ? <div className="text-zinc-700">{children}</div> : null}
    </div>
  );
}
