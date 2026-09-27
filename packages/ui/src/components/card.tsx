import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'ink' | 'muted';
  size?: 'card' | 'panel';
}

const TONE = {
  default: 'bg-white border border-zinc-200 text-zinc-900',
  muted: 'bg-zinc-100 text-zinc-900',
  ink: 'bg-ink text-white',
} as const;

export function Card({ tone = 'default', size = 'card', className, ...rest }: CardProps) {
  return (
    <div
      className={cx(TONE[tone], size === 'card' ? 'rounded-card p-5' : 'rounded-panel p-6', className)}
      {...rest}
    />
  );
}

export function CardLabel({ children }: { children: ReactNode }) {
  return <p className="font-mono text-label uppercase text-zinc-500">{children}</p>;
}
