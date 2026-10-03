import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';

/**
 * The page header (ADR 0022): breadcrumb or eyebrow, an 800-weight title (40 px from md), an
 * optional tag, a meta row (status, date, venue) and the actions, primary action last (top end).
 */
export function PageHeader({
  eyebrow,
  breadcrumb,
  title,
  tag,
  description,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  /** A <Breadcrumb>; shown above the title instead of (or with) the eyebrow. */
  breadcrumb?: ReactNode;
  title: ReactNode;
  /** A <Tag> next to the title ("WEDDING"). */
  tag?: ReactNode;
  description?: ReactNode;
  /** A row of status, date and place under the title. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-4">
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
        {breadcrumb}
        {eyebrow}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-[30px] leading-[1.08] font-extrabold tracking-[-0.035em] text-ink md:text-title">
            {title}
          </h1>
          {tag}
        </div>
        {description ? (
          <p className="m-0 max-w-[90ch] text-[15px] leading-[1.55] text-ink-2">{description}</p>
        ) : null}
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-body text-ink-2">{meta}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/** A section's heading row inside a page: title, optional count/description and actions. */
export function SectionHeader({
  title,
  id,
  description,
  count,
  actions,
  as: Heading = 'h2',
}: {
  title: ReactNode;
  id?: string;
  description?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={id} className="m-0 flex items-center gap-2 text-card text-ink">
          {title}
          {count !== undefined ? (
            <span className="rounded-[7px] bg-surface-3 px-2 py-0.5 text-caption font-bold text-ink-2 tabular-nums">
              {count}
            </span>
          ) : null}
        </Heading>
        {description ? <p className="m-0 text-body text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Empty state: every list and page section has one, saying what to do next (M1.1). */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** A 24 px line icon, shown in a soft violet tile. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong/50 bg-surface px-6 py-12 text-center glass',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-1 flex size-12 items-center justify-center rounded-tile bg-primary-soft text-primary-ink [&_svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <p className="m-0 text-card text-ink">{title}</p>
      {description ? <p className="m-0 max-w-md text-body text-ink-2">{description}</p> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Loading placeholder (no spinners for content): a soft shimmer, still under reduced motion. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-tile bg-surface-3 motion-reduce:animate-none', className)}
      {...rest}
    />
  );
}

/** Skeleton lines for a paragraph or list. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3', 'w-3/4'];
  return (
    <div aria-hidden="true" className={cx('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={widths[i % widths.length] + String(i)}
          className={cx('h-3.5 rounded-pill', widths[i % widths.length])}
        />
      ))}
    </div>
  );
}

/** A card-shaped skeleton (KPI cards, list rows) with a live region saying it is loading. */
export function SkeletonCard({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      className={cx('flex flex-col gap-3 rounded-card border border-line bg-surface p-5', className)}
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-1/3 rounded-pill" />
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-1.5 w-full rounded-pill" />
    </div>
  );
}

/** Something failed to load: what happened, and a way to try again. */
export function ErrorState({
  title,
  description,
  retry,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** A retry button or link. */
  retry?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx(
        'flex flex-col items-center gap-3 rounded-card border border-danger/30 bg-danger-soft px-6 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-tile bg-surface-solid text-danger"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3 2.5 20h19L12 3z" />
          <path d="M12 10v4.5M12 17.5h.01" />
        </svg>
      </span>
      <p className="m-0 text-card text-ink">{title}</p>
      {description ? <p className="m-0 max-w-md text-body text-ink-2">{description}</p> : null}
      {retry}
    </div>
  );
}

const ALERT = {
  danger: { box: 'border-danger/30 bg-danger-soft', title: 'text-danger', role: 'alert' },
  info: { box: 'border-line bg-surface', title: 'text-ink', role: 'status' },
  success: { box: 'border-success/30 bg-success-soft', title: 'text-success', role: 'status' },
  warning: { box: 'border-warning/30 bg-warning-soft', title: 'text-warning', role: 'status' },
} as const;

/** Inline alert for problem+json errors mapped to a localized message, and for notices. */
export function Alert({
  tone = 'danger',
  title,
  children,
  className,
}: {
  tone?: keyof typeof ALERT;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const a = ALERT[tone];
  return (
    <div
      role={a.role}
      className={cx('flex flex-col gap-1 rounded-tile border px-4 py-3 text-body', a.box, className)}
    >
      <p className={cx('m-0 font-bold', a.title)}>{title}</p>
      {children ? <div className="text-ink">{children}</div> : null}
    </div>
  );
}

export interface Step {
  readonly label: ReactNode;
  readonly state: 'done' | 'current' | 'todo';
  readonly href?: string;
}

/** Numbered steps (wizards, setup). The current step is announced with aria-current. */
export function Stepper({ steps, label }: { steps: readonly Step[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
        {steps.map((s, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are a fixed sequence; labels may repeat
            key={`${i}-${typeof s.label === 'string' ? s.label : ''}`}
            aria-current={s.state === 'current' ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            <span
              className={cx(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-extrabold tabular-nums',
                s.state === 'done' && 'bg-success-dot text-black',
                s.state === 'current' && 'bg-primary text-on-primary',
                s.state === 'todo' && 'border border-line-strong text-ink-2',
              )}
            >
              {i + 1}
            </span>
            <span
              className={cx(
                'text-body',
                s.state === 'current' ? 'font-extrabold text-ink' : 'font-semibold text-ink-2',
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span aria-hidden="true" className="mx-1 h-px w-6 bg-line-strong/50" />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface LaneItem {
  readonly id: string;
  readonly title: ReactNode;
  readonly time: ReactNode;
  readonly where?: ReactNode;
  /** now: outlined in mint; done / next / plain. */
  readonly state?: 'now' | 'done' | 'next' | 'plain';
  readonly chip?: ReactNode;
}

const LANE: Record<NonNullable<LaneItem['state']>, { box: string; chip: string }> = {
  now: {
    box: 'border-success bg-success-soft ring-[3px] ring-success-soft',
    chip: 'bg-success-dot text-black',
  },
  done: { box: 'border-line bg-surface-2', chip: 'bg-success-soft text-success' },
  next: { box: 'border-line bg-surface-2', chip: 'bg-warning-soft text-warning' },
  plain: { box: 'border-line bg-surface-2', chip: 'bg-tag text-tag-ink' },
};

/**
 * Timeline / schedule lane (run of show, programme): items in time order, the current one outlined
 * in mint. A list, so it reads in order with a screen reader and wraps on phones.
 */
export function ScheduleLane({ items, label }: { items: readonly LaneItem[]; label: string }) {
  return (
    <ol
      aria-label={label}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5 p-0"
    >
      {items.map((it) => {
        const s = LANE[it.state ?? 'plain'];
        return (
          <li
            key={it.id}
            aria-current={it.state === 'now' ? 'time' : undefined}
            className={cx('flex min-w-0 flex-col gap-2 rounded-tile border p-3.5', s.box)}
          >
            <div className="flex items-start gap-2">
              <span className="grow text-body font-extrabold text-ink">{it.title}</span>
              {it.chip ? (
                <span className={cx('rounded-pill px-2 py-0.5 text-[11px] font-extrabold', s.chip)}>
                  {it.chip}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 text-caption font-semibold text-ink-2 tabular-nums">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span>
                {it.time}
                {it.where ? <> · {it.where}</> : null}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A vertical timeline (order history, activity): dot, time and text per entry. */
export function Timeline({
  items,
  label,
}: {
  items: readonly {
    id: string;
    time: ReactNode;
    title: ReactNode;
    detail?: ReactNode;
    tone?: 'primary' | 'success' | 'danger' | 'neutral';
  }[];
  label: string;
}) {
  const dot = {
    primary: 'bg-primary',
    success: 'bg-success-dot',
    danger: 'bg-danger-dot',
    neutral: 'bg-ink-3',
  };
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 ? (
            <span aria-hidden="true" className="absolute start-[5px] top-4 bottom-0 w-px bg-line" />
          ) : null}
          <span
            aria-hidden="true"
            className={cx('mt-1.5 size-[11px] shrink-0 rounded-full', dot[it.tone ?? 'neutral'])}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body font-bold text-ink">{it.title}</span>
            <span className="text-caption text-ink-2 tabular-nums">{it.time}</span>
            {it.detail ? <span className="text-body text-ink-2">{it.detail}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
