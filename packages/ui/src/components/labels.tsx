import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import type { Status, StatusTone } from '../tokens.ts';

/** Dark uppercase tag ("WEBSITE", "WEDDING", "BLACK TIE"). */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-tag bg-tag px-2.5 py-1.5 text-label leading-none tracking-[0.08em] text-tag-ink uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}

const PILL: Record<StatusTone, { pill: string; dot: string }> = {
  success: { pill: 'bg-success-soft text-success', dot: 'bg-success-dot' },
  waiting: { pill: 'bg-warning-soft text-warning', dot: 'bg-warning-dot' },
  danger: { pill: 'bg-danger-soft text-danger', dot: 'bg-danger-dot' },
  info: { pill: 'bg-primary-soft text-primary-ink', dot: 'bg-primary' },
  neutral: { pill: 'bg-surface-3 text-ink-2', dot: 'bg-ink-3' },
  brand: { pill: 'bg-brand-soft text-brand-ink', dot: 'bg-brand' },
};

/**
 * Status as a soft pill with a dot AND a word ("Attending", "Awaiting", "Declined"): never hue
 * alone. `live` pulses the dot (reduced motion: still).
 */
export function StatusPill({
  tone,
  label,
  live = false,
  className,
}: {
  tone: StatusTone;
  label: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const s = PILL[tone];
  return (
    <span
      data-status={tone}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-extrabold whitespace-nowrap',
        s.pill,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-[7px] shrink-0 rounded-full',
          s.dot,
          live && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      {label}
    </span>
  );
}

const DOT: Record<Status, string> = {
  success: 'bg-success-dot',
  warning: 'bg-warning-dot',
  danger: 'bg-danger-dot',
  info: 'bg-primary',
  neutral: 'bg-ink-3',
};

/** Quiet inline status (dot plus text, no fill) for dense rows. Prefer StatusPill elsewhere. */
export function StatusDot({
  status,
  label,
  live = false,
}: {
  status: Status;
  label: string;
  live?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 text-caption font-semibold text-ink-2"
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-2 shrink-0 rounded-full',
          DOT[status],
          live && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      {label}
    </span>
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'brand' | 'danger' | 'success' | 'inverse';
const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  primary: 'bg-primary-soft text-primary-ink',
  brand: 'bg-brand-strong text-white',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  inverse: 'bg-white text-black',
};

/** Count badge ("3", "7/10"): tabular, never the only signal (pair it with a label). */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[7px] px-1.5 text-caption font-extrabold tabular-nums',
        BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Nav-item count (kept for existing callers): a badge pushed to the end of its row.
 * `accent` is the attention tone, `neutral` the quiet one.
 */
export function Chip({ tone = 'accent', children }: { tone?: 'accent' | 'neutral'; children: ReactNode }) {
  return (
    <Badge tone={tone === 'accent' ? 'inverse' : 'neutral'} className="ms-auto">
      {children}
    </Badge>
  );
}

/** Uppercase label (11 px, 800, 0.1 em). `tone="inverse"` on dark or violet surfaces. */
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
      className={cx('text-label uppercase', tone === 'inverse' ? 'text-white/80' : 'text-ink-2', className)}
    >
      {children}
    </span>
  );
}

/** Keyboard shortcut hint ("⌘K", "/"). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] border border-line bg-surface-2 px-1.5 font-sans text-caption font-bold text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
