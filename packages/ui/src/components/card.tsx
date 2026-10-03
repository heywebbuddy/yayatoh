import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';

/**
 * Surfaces (ADR 0022). `default`: white card with a thin border (glass in dark mode). `muted`: an
 * inset tile on a card. `ink`: the dark card (tag colour). `highlight`: the pink-to-lavender card
 * with a huge number. `feature`: the soft violet "next step" card. `hero`: violet light.
 */
export type CardTone = 'default' | 'muted' | 'ink' | 'highlight' | 'feature' | 'hero';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  /** card: 24 px radius, 20 px padding; panel: 28 px radius, 24 px padding. */
  size?: 'card' | 'panel';
  /** Hover lift for cards that are links or open something. */
  interactive?: boolean;
}

const TONE: Record<CardTone, string> = {
  default: 'border border-line bg-surface text-ink elevation-card glass',
  muted: 'border border-line bg-surface-2 text-ink',
  ink: 'bg-tag text-tag-ink',
  highlight: 'bg-highlight text-hero-ink elevation-card',
  feature: 'border border-line bg-feature text-ink elevation-card',
  hero: 'bg-hero text-white elevation-card',
};

export function cardClass(tone: CardTone = 'default', size: 'card' | 'panel' = 'card', interactive = false) {
  return cx(
    TONE[tone],
    size === 'card' ? 'rounded-card p-5' : 'rounded-panel p-6',
    interactive &&
      'transition-[box-shadow,border-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-line-strong hover:elevation-pop',
  );
}

export function Card({
  tone = 'default',
  size = 'card',
  interactive = false,
  className,
  ...rest
}: CardProps) {
  return <div className={cx(cardClass(tone, size, interactive), className)} {...rest} />;
}

/** Small uppercase label at the top of a card. */
export function CardLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-label uppercase text-ink-2', className)}>{children}</p>;
}

/** A card's title row: heading, optional meta and actions on the end side. */
export function CardHeader({
  title,
  meta,
  actions,
  as: Heading = 'h2',
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Heading id={id} className="m-0 grow text-card text-ink">
        {title}
      </Heading>
      {meta ? <span className="text-[13px] text-ink-2">{meta}</span> : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type DeltaTone = 'success' | 'danger' | 'neutral' | 'primary';
const DELTA: Record<DeltaTone, string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-3 text-ink-2',
  primary: 'bg-primary-soft text-primary-ink',
};
export type BarTone = 'primary' | 'success' | 'brand' | 'warning' | 'danger';
const BAR: Record<BarTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success-dot',
  brand: 'bg-brand',
  warning: 'bg-warning-dot',
  danger: 'bg-danger-dot',
};
/** Progress widths as static classes (the strict CSP allows no style attributes). */
const WIDTH = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
] as const;
/** The nearest 5 % width class for a 0–100 value. */
export const widthClass = (pct: number) => WIDTH[Math.round(Math.min(100, Math.max(0, pct)) / 5)] as string;

/** A thin progress bar with its value for assistive tech. */
export function ProgressBar({
  value,
  max = 100,
  label,
  tone = 'primary',
  className,
}: {
  value: number;
  max?: number;
  label: string;
  tone?: BarTone;
  className?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx('h-1.5 overflow-hidden rounded-pill bg-surface-3', className)}
    >
      <div className={cx('h-full rounded-pill', BAR[tone], widthClass(pct))} />
    </div>
  );
}

/**
 * KPI / stat card: label, a big tabular number, an optional delta chip ("+16%"), an optional
 * progress bar and a one-line footnote ("of 1,500 · 216 left").
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = 'success',
  progress,
  sub,
  className,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  progress?: { value: number; max?: number; label: string; tone?: BarTone };
  sub?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cx(cardClass('default'), 'flex flex-col gap-2.5', className)} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 text-body font-semibold text-ink-2">
        <span>{label}</span>
        {delta ? (
          <span
            className={cx('rounded-pill px-2.5 py-0.5 text-caption font-bold tabular-nums', DELTA[deltaTone])}
          >
            {delta}
          </span>
        ) : null}
      </div>
      <div className="text-stat text-ink tabular-nums">{value}</div>
      {progress ? <ProgressBar {...progress} /> : null}
      {sub ? <div className="text-[13px] text-ink-2">{sub}</div> : null}
    </div>
  );
}

/** The highlight card: soft pink-to-lavender (violet light in dark mode) with a huge number. */
export function HighlightCard({
  label,
  value,
  chip,
  sub,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  chip?: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        cardClass('highlight'),
        'relative isolate flex min-h-[170px] flex-col gap-2 overflow-hidden',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute -end-10 -top-14 -z-10 size-56 rounded-full bg-white/50 blur-md dark:bg-primary-ink/40"
      />
      <span className="text-label text-[13px] uppercase">{label}</span>
      <span className="grow" />
      {sub || chip ? (
        <span className="flex flex-wrap items-center gap-2.5">
          {sub ? <span className="text-body font-semibold">{sub}</span> : null}
          {chip ? (
            <span className="rounded-pill bg-brand-strong px-2.5 py-1 text-caption font-extrabold text-white">
              {chip}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="text-[52px] leading-none font-extrabold tracking-[-0.045em] tabular-nums">
        {value}
      </span>
    </div>
  );
}
