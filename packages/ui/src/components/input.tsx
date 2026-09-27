import type { InputHTMLAttributes } from 'react';
import { cx } from '../cx.ts';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visually rendered label; always associated with the input. */
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({ id, label, hint, error, className, ...rest }: InputProps) {
  const inputId = id ?? rest.name;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-caption text-zinc-600">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'min-h-10 w-full rounded-pill border bg-white px-4 text-body text-zinc-900 placeholder:text-zinc-400',
          'outline-none focus-visible:border-zinc-900',
          error ? 'border-pink-700' : 'border-zinc-200',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-caption text-pink-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-caption text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
