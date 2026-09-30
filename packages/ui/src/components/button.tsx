import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from '../cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'on-dark' | 'glass';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-zinc-800',
  secondary: 'bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50',
  ghost: 'bg-transparent text-zinc-900 hover:bg-zinc-100',
  'on-dark': 'bg-white text-ink hover:bg-zinc-100',
  glass: 'bg-glass text-white backdrop-blur hover:bg-white/20',
};

// Every size keeps the target ≥ 24 px (MIN_TARGET_PX).
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-7 px-3 text-caption',
  md: 'min-h-10 px-[18px] py-[11px] text-body',
  lg: 'min-h-12 px-6 text-[15px]',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-pill font-normal leading-none whitespace-nowrap',
    'transition-colors disabled:pointer-events-none disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
