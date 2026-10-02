import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../cx.ts';

/** The field look (ADR 0022): `field` is a utility in styles.css; sizes `field-sm`, `field-lg`. */
export function fieldClass(size: 'sm' | 'md' | 'lg' = 'md', className?: string): string {
  return cx('field', size === 'sm' && 'field-sm', size === 'lg' && 'field-lg', className);
}

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mt-px size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  );
}

/** A field's message line: the error (with an icon) or the help text. */
export function FieldMessage({ id, error, hint }: { id: string; error?: ReactNode; hint?: ReactNode }) {
  if (error)
    return (
      <p id={`${id}-error`} className="flex items-start gap-1.5 text-caption font-semibold text-danger">
        <ErrorIcon />
        <span>{error}</span>
      </p>
    );
  if (hint)
    return (
      <p id={`${id}-hint`} className="text-caption text-ink-2">
        {hint}
      </p>
    );
  return null;
}

const describedBy = (id: string, error?: ReactNode, hint?: ReactNode) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

/** The field's label. `required` is announced by the control itself (no asterisk in the name). */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-bold text-ink">
      {children}
    </label>
  );
}

/** Wrapper for any custom control: label, the control, then help or the error. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      {children}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visually rendered label; always associated with the input. */
  label?: string;
  hint?: string;
  error?: string;
  /** sm 32 px, md 44 px (default), lg 56 px. */
  fieldSize?: 'sm' | 'md' | 'lg';
}

export function Input({ id, label, hint, error, className, fieldSize = 'md', ...rest }: InputProps) {
  const inputId = id ?? rest.name ?? '';
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <FieldLabel htmlFor={inputId} required={rest.required}>
          {label}
        </FieldLabel>
      ) : null}
      <input
        id={inputId || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        className={fieldClass(fieldSize, cx('w-full', className))}
        {...rest}
      />
      <FieldMessage id={inputId} error={error} hint={hint} />
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  fieldSize?: 'sm' | 'md' | 'lg';
}

export function Select({
  id,
  label,
  hint,
  error,
  className,
  fieldSize = 'md',
  children,
  ...rest
}: SelectProps) {
  const selectId = id ?? rest.name ?? '';
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <FieldLabel htmlFor={selectId} required={rest.required}>
          {label}
        </FieldLabel>
      ) : null}
      <select
        id={selectId || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(selectId, error, hint)}
        className={fieldClass(fieldSize, cx('w-full pe-9', className))}
        {...rest}
      >
        {children}
      </select>
      <FieldMessage id={selectId} error={error} hint={hint} />
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({ id, label, hint, error, className, rows = 4, ...rest }: TextareaProps) {
  const areaId = id ?? rest.name ?? '';
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <FieldLabel htmlFor={areaId} required={rest.required}>
          {label}
        </FieldLabel>
      ) : null}
      <textarea
        id={areaId || undefined}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(areaId, error, hint)}
        className={fieldClass('md', cx('w-full py-3 leading-relaxed', className))}
        {...rest}
      />
      <FieldMessage id={areaId} error={error} hint={hint} />
    </div>
  );
}

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

/** Checkbox or radio with its label; the whole row is the 44 px target. */
function Choice({ type, id, label, hint, className, ...rest }: ChoiceProps & { type: 'checkbox' | 'radio' }) {
  const choiceId = id ?? `${rest.name ?? 'choice'}-${String(rest.value ?? '')}`;
  return (
    <label
      htmlFor={choiceId}
      className={cx(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-control py-2.5 text-body has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55',
        className,
      )}
    >
      <input
        id={choiceId}
        type={type}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-primary"
        aria-describedby={hint ? `${choiceId}-hint` : undefined}
        {...rest}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold text-ink">{label}</span>
        {hint ? (
          <span id={`${choiceId}-hint`} className="text-caption text-ink-2">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export const Checkbox = (p: ChoiceProps) => <Choice type="checkbox" {...p} />;
export const Radio = (p: ChoiceProps) => <Choice type="radio" {...p} />;

/**
 * On/off switch: a real checkbox with `role="switch"` (keyboard: Space), drawn as a track and a
 * knob. The label is the switch's name.
 */
export function Switch({ id, label, hint, className, ...rest }: ChoiceProps) {
  const switchId = id ?? `${rest.name ?? 'switch'}`;
  return (
    <label
      htmlFor={switchId}
      className={cx(
        'flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-control py-2 text-body has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55',
        className,
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold text-ink">{label}</span>
        {hint ? (
          <span id={`${switchId}-hint`} className="text-caption text-ink-2">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          id={switchId}
          type="checkbox"
          // biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox exposes its checked state to the switch role (HTML-AAM)
          role="switch"
          className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
          aria-describedby={hint ? `${switchId}-hint` : undefined}
          {...rest}
        />
        <span
          aria-hidden="true"
          className="h-7 w-12 rounded-pill border border-line-strong bg-surface-3 transition-colors duration-150 peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute start-1 top-1 size-5 rounded-full bg-white elevation-card transition-transform duration-150 peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5"
        />
      </span>
    </label>
  );
}
