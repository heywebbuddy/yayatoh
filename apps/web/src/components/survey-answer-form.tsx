'use client';

import type { FieldType } from '@yayatoh/forms/ui';
import { NPS_MAX, RATING_MAX } from '@yayatoh/forms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import type { SurveyFormState } from '@/app/[locale]/survey/[token]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export interface SurveyQuestion {
  readonly key: string;
  readonly type: FieldType;
  readonly label: string;
  readonly help: string | null;
  readonly required: boolean;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly min: number | null;
  readonly max: number | null;
}

/** Scale choices as large pill radios: arrow keys move within the group, 44 px targets. */
const PILL =
  'flex size-11 cursor-pointer items-center justify-center rounded-pill border border-zinc-200 bg-white font-mono text-body text-zinc-900 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink';

/**
 * The respondent's form, mobile first. The server validates every answer again; its answer
 * decides which question is marked (and focused) when something needs fixing.
 */
export function SurveyAnswerForm({
  action,
  questions,
}: {
  action: (prev: SurveyFormState, form: FormData) => Promise<SurveyFormState>;
  questions: readonly SurveyQuestion[];
}) {
  const t = useTranslations('survey');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { code: null } as SurveyFormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.field) return;
    ref.current?.querySelector<HTMLElement>(`[name="q:${state.field}"]`)?.focus();
  }, [state]);

  const errorOf = (key: string) =>
    state.field === key
      ? state.code === 'required'
        ? t('errors.required')
        : t('errors.invalid')
      : undefined;
  const title = (q: SurveyQuestion) => `${q.label}${q.required ? '' : ` ${t('optional')}`}`;
  const general =
    state.code && !state.field
      ? t.has(`errors.${state.code}`)
        ? t(`errors.${state.code}`)
        : tr(errorMessageKey(state.code))
      : null;

  return (
    <form
      ref={ref}
      // No automatic reset: when an answer needs fixing, everything else answered stays.
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
      noValidate
      aria-label={t('formLabel')}
      className="flex flex-col gap-6"
    >
      {questions.map((q) => {
        const name = `q:${q.key}`;
        const id = `q-${q.key}`;
        const error = errorOf(q.key);
        const errorId = `${id}-error`;
        const errorText = error ? (
          <p id={errorId} className="text-caption text-pink-700">
            {error}
          </p>
        ) : null;
        if (q.type === 'nps' || q.type === 'rating') {
          const from = q.type === 'nps' ? 0 : 1;
          const to = q.type === 'nps' ? NPS_MAX : RATING_MAX;
          const hintId = `${id}-hint`;
          return (
            <fieldset
              key={q.key}
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              aria-invalid={error ? true : undefined}
              className="flex flex-col gap-2 border-0 p-0"
            >
              <legend className="mb-2 text-body font-medium text-zinc-900">{title(q)}</legend>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((v) => (
                  <label key={v} className={PILL}>
                    <input type="radio" name={name} value={v} className="sr-only" />
                    {q.type === 'rating' ? (
                      <>
                        <span aria-hidden="true">{v}</span>
                        <span className="sr-only">{t('ratingOption', { n: v, max: to })}</span>
                      </>
                    ) : (
                      v
                    )}
                  </label>
                ))}
              </div>
              <p id={hintId} className="text-caption text-zinc-600">
                {q.type === 'nps' ? t('npsScale') : t('ratingScale')}
              </p>
              {errorText}
            </fieldset>
          );
        }
        if (q.type === 'checkbox')
          return (
            <div key={q.key} className="flex flex-col gap-1">
              <label className="flex min-h-6 items-start gap-2.5 text-body">
                <input
                  type="checkbox"
                  name={name}
                  value="1"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="mt-0.5 size-5 shrink-0 accent-ink"
                />
                <span>{title(q)}</span>
              </label>
              {errorText}
            </div>
          );
        if (q.type === 'select' || q.type === 'multi_select')
          return (
            <fieldset
              key={q.key}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              className="flex flex-col gap-2 border-0 p-0"
            >
              <legend className="mb-1 text-body font-medium text-zinc-900">{title(q)}</legend>
              {q.options.map((o) => (
                <label key={o.value} className="flex min-h-6 items-center gap-2.5 text-body">
                  <input
                    type={q.type === 'select' ? 'radio' : 'checkbox'}
                    name={name}
                    value={o.value}
                    className="size-5 accent-ink"
                  />
                  {o.label}
                </label>
              ))}
              {errorText}
            </fieldset>
          );
        if (q.type === 'long_text')
          return (
            <div key={q.key} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-body font-medium text-zinc-900">
                {title(q)}
              </label>
              <textarea
                id={id}
                name={name}
                maxLength={2000}
                rows={4}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={`rounded-card border bg-white px-4 py-2.5 text-body text-zinc-900 ${error ? 'border-pink-700' : 'border-zinc-200'}`}
              />
              {errorText}
            </div>
          );
        const numeric = q.type === 'number' || q.type === 'count';
        return (
          <Input
            key={q.key}
            id={id}
            name={name}
            type={numeric ? 'number' : 'text'}
            inputMode={numeric ? 'numeric' : undefined}
            min={q.type === 'count' ? Math.max(0, q.min ?? 0) : (q.min ?? undefined)}
            max={q.max ?? undefined}
            step={q.type === 'count' ? 1 : 'any'}
            maxLength={numeric ? undefined : 200}
            label={title(q)}
            hint={q.help ?? undefined}
            error={error}
          />
        );
      })}
      <div aria-live="polite">{general ? <Alert title={general} /> : null}</div>
      <Button type="submit" disabled={pending} className="self-stretch sm:self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
