'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** A program form's result: the usual state plus schedule warnings (already localized). */
export type ProgramFormState = FormState & { readonly warnings?: readonly string[] };

interface Base {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly required?: boolean;
}
export type FieldSpec =
  | (Base & {
      readonly kind: 'text' | 'url' | 'number' | 'datetime-local';
      readonly defaultValue?: string;
      readonly maxLength?: number;
      /** Completions offered while typing (a datalist). */
      readonly suggestions?: readonly string[];
    })
  | (Base & { readonly kind: 'textarea'; readonly defaultValue?: string; readonly rows?: number })
  | (Base & {
      readonly kind: 'select';
      readonly options: readonly { value: string; label: string }[];
      readonly defaultValue?: string;
    })
  | (Base & {
      readonly kind: 'checkboxes';
      readonly options: readonly { value: string; label: string }[];
      readonly defaultValues?: readonly string[];
    });

const control = 'min-h-10 rounded-pill border bg-white px-4 text-body';
const area = 'rounded-card border bg-white px-4 py-2 text-body';

/**
 * One add/edit form of the program pages (M1.4f). Every field has a visible label; a rejected
 * field gets `aria-invalid` and its message (field errors map by input name, domain reasons by
 * `details.reason`). Values survive a rejected submit; an add form clears after success.
 */
export function ProgramForm({
  action,
  fields,
  idPrefix,
  submitLabel,
  successLabel,
  errors,
  reset = false,
}: {
  action: (prev: ProgramFormState, form: FormData) => Promise<ProgramFormState>;
  fields: readonly FieldSpec[];
  idPrefix: string;
  submitLabel: string;
  successLabel: string;
  /** Field name or domain reason → message. */
  errors: Readonly<Record<string, string>>;
  reset?: boolean;
}) {
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as ProgramFormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && reset) ref.current?.reset();
  }, [state, reset]);
  const bad = new Set(state.fields ?? []);
  // A rejected field's message: its domain reason, then `code.field` (e.g. a taken name), then
  // the field's own message.
  const messageFor = (name: string) =>
    bad.has(name)
      ? ((state.reason ? errors[state.reason] : undefined) ??
        errors[`${state.code}.${name}`] ??
        errors[name] ??
        te('errors.validation_failed'))
      : undefined;
  const fieldError = fields.some((f) => bad.has(f.name));
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-4"
      noValidate
    >
      {fields.map((f) => {
        const error = messageFor(f.name);
        if (f.kind === 'textarea')
          return (
            <div key={f.name} className="flex flex-col gap-1.5">
              <label htmlFor={id(f.name)} className="text-caption text-zinc-600">
                {f.label}
              </label>
              <textarea
                id={id(f.name)}
                name={f.name}
                rows={f.rows ?? 4}
                defaultValue={f.defaultValue ?? ''}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id(f.name)}-error` : f.hint ? `${id(f.name)}-hint` : undefined}
                className={`${area} ${error ? 'border-pink-700' : 'border-zinc-200'}`}
              />
              {error ? (
                <p id={`${id(f.name)}-error`} className="text-caption text-pink-700">
                  {error}
                </p>
              ) : f.hint ? (
                <p id={`${id(f.name)}-hint`} className="text-caption text-zinc-500">
                  {f.hint}
                </p>
              ) : null}
            </div>
          );
        if (f.kind === 'select')
          return (
            <div key={f.name} className="flex flex-col gap-1.5">
              <label htmlFor={id(f.name)} className="text-caption text-zinc-600">
                {f.label}
              </label>
              <select
                id={id(f.name)}
                name={f.name}
                defaultValue={f.defaultValue ?? ''}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id(f.name)}-error` : f.hint ? `${id(f.name)}-hint` : undefined}
                className={`${control} ${error ? 'border-pink-700' : 'border-zinc-200'}`}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {error ? (
                <p id={`${id(f.name)}-error`} className="text-caption text-pink-700">
                  {error}
                </p>
              ) : f.hint ? (
                <p id={`${id(f.name)}-hint`} className="text-caption text-zinc-500">
                  {f.hint}
                </p>
              ) : null}
            </div>
          );
        if (f.kind === 'checkboxes')
          return f.options.length === 0 ? null : (
            <fieldset
              key={f.name}
              className="flex flex-col gap-1.5"
              aria-describedby={error ? `${id(f.name)}-error` : undefined}
            >
              <legend className="pb-1.5 text-caption text-zinc-600">{f.label}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {f.options.map((o) => (
                  <label key={o.value} className="flex min-h-6 items-center gap-2 text-body">
                    <input
                      type="checkbox"
                      name={f.name}
                      value={o.value}
                      defaultChecked={f.defaultValues?.includes(o.value)}
                      className="size-5"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              {error ? (
                <p id={`${id(f.name)}-error`} className="text-caption text-pink-700">
                  {error}
                </p>
              ) : null}
            </fieldset>
          );
        const input = (
          <Input
            key={f.name}
            id={id(f.name)}
            name={f.name}
            type={f.kind}
            label={f.label}
            hint={f.hint}
            required={f.required}
            maxLength={f.maxLength}
            defaultValue={f.defaultValue}
            error={error}
            {...(f.kind === 'number' ? { min: 1, inputMode: 'numeric' as const } : {})}
            {...(f.suggestions?.length ? { list: `${id(f.name)}-list`, autoComplete: 'off' } : {})}
          />
        );
        return f.suggestions?.length ? (
          <div key={f.name}>
            {input}
            <datalist id={`${id(f.name)}-list`}>
              {f.suggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
        ) : (
          input
        );
      })}
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={successLabel} /> : null}
        {state.ok && !pending && state.warnings?.length
          ? state.warnings.map((w) => <ScheduleWarning key={w}>{w}</ScheduleWarning>)
          : null}
        {state.code && !fieldError ? (
          <Alert title={(state.reason && errors[state.reason]) || te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}

/** A schedule conflict: saved anyway, but worth a look (M1.4f conflict warnings). */
export function ScheduleWarning({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-card border border-accent-300 bg-accent-50 px-4 py-3 text-body text-accent-text"
    >
      {children}
    </p>
  );
}
