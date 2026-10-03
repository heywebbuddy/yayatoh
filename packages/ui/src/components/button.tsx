import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../cx.ts';

/**
 * ADR 0022 actions. One `primary` per screen (top right in the PageHeader); `secondary` for the
 * rest; `dark` for strong neutral actions; `ghost` inside toolbars and rows; `danger` for
 * destructive actions (always confirmed); `inverse` on the violet hero and dark promo cards.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger' | 'inverse';
/** 36 / 44 / 54 px. Every size is above the 24 px minimum; 44 is the touch default. */
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary elevation-primary hover:bg-primary-hover active:bg-primary-pressed',
  secondary:
    'border border-line bg-surface text-ink glass hover:border-line-strong hover:bg-surface-2 active:bg-surface-3',
  dark: 'bg-tag text-tag-ink hover:opacity-90 active:opacity-80',
  ghost: 'bg-transparent text-ink hover:bg-surface-3 active:bg-line',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:border-danger active:opacity-85',
  inverse: 'border border-white/30 bg-white/15 text-white backdrop-blur hover:bg-white/25 active:bg-white/30',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 rounded-[12px] px-3.5 text-[13px]',
  md: 'min-h-11 rounded-control px-[18px] text-body',
  lg: 'min-h-[54px] rounded-tile px-6 text-[16px]',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex items-center justify-center gap-2 font-bold leading-none whitespace-nowrap select-none',
    // No opacity transition: a button re-enabled after an action is at full contrast at once.
    'transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:size-[18px] [&_svg]:shrink-0',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

/** A small spinner for a button that is working (the button also gets aria-busy). */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cx('size-4 animate-spin motion-reduce:animate-none', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Working: shows a spinner, sets aria-busy and blocks further clicks. */
  loading?: boolean;
  /** An icon before the label (24 px grid, 2 px stroke). */
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  loading = false,
  icon,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'size-9 rounded-[12px]',
  md: 'size-11 rounded-control',
  lg: 'size-[54px] rounded-tile',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  ref?: Ref<HTMLButtonElement>;
  /** Required: an icon-only control needs a name. */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, 'primary'> | 'primary';
  size?: ButtonSize;
}

/** Square icon-only button with an accessible name (and a tooltip-style title). */
export function IconButton({
  label,
  icon,
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(buttonClass(variant, size), 'px-0', ICON_SIZE[size], className)}
      {...rest}
    >
      {icon}
    </button>
  );
}

/** Class for an icon-only link styled like IconButton (pass aria-label on the link). */
export function iconButtonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return cx(buttonClass(variant, size), 'px-0', ICON_SIZE[size], className);
}
