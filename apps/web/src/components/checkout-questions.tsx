'use client';

import { evaluate, type FieldType, type Logic } from '@yayatoh/forms/ui';
import { Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface QuestionView {
  readonly key: string;
  readonly type: FieldType;
  readonly label: string;
  readonly help: string | null;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly min: number | null;
  readonly max: number | null;
  readonly showIf: unknown;
}

/**
 * The event's checkout questions. Conditions are evaluated here only to show or hide fields;
 * the server validates the answers again against the published version.
 */
export function CheckoutQuestions({
  questions,
  invalidKey,
}: {
  questions: readonly QuestionView[];
  invalidKey?: string;
}) {
  const t = useTranslations();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const set = (k: string, v: unknown) => setAnswers((a) => ({ ...a, [k]: v }));
  // Same rule as the server: a condition sees the answers of the fields before it.
  const visible = new Set<string>();
  const seen: Record<string, unknown> = {};
  for (const q of questions) {
    if (q.showIf === null || evaluate(q.showIf as Logic, seen)) {
      visible.add(q.key);
      if (answers[q.key] !== undefined) seen[q.key] = answers[q.key];
    }
  }
  const error = (k: string) => (invalidKey === k ? t('checkout.questionInvalid') : undefined);
  const label = (q: QuestionView) =>
    `${q.label}${q.required ? '' : ` ${t('checkout.optional')}`}${q.sensitive ? ` ${t('checkout.private')}` : ''}`;

  return (
    <fieldset className="flex flex-col gap-4 border-0 p-0">
      <legend className="mb-2 text-section">{t('checkout.questions')}</legend>
      {questions
        .filter((q) => visible.has(q.key))
        .map((q) => {
          const name = `q:${q.key}`;
          const id = `q-${q.key}`;
          if (q.type === 'checkbox') {
            return (
              <label key={q.key} className="flex min-h-6 items-start gap-2.5 text-body">
                <input
                  type="checkbox"
                  name={name}
                  value="1"
                  required={q.required}
                  onChange={(e) => set(q.key, e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span>{label(q)}</span>
              </label>
            );
          }
          if (q.type === 'select') {
            return (
              <div key={q.key} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-caption text-ink-2">
                  {label(q)}
                </label>
                <select
                  id={id}
                  name={name}
                  required={q.required}
                  defaultValue=""
                  aria-invalid={error(q.key) ? true : undefined}
                  onChange={(e) => set(q.key, e.target.value || undefined)}
                  className="field"
                >
                  <option value="">{t('checkout.choose')}</option>
                  {q.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (q.type === 'multi_select') {
            return (
              <fieldset key={q.key} className="flex flex-col gap-1.5 border-0 p-0">
                <legend className="text-caption text-ink-2">{label(q)}</legend>
                {q.options.map((o) => (
                  <label key={o.value} className="flex min-h-6 items-center gap-2.5 text-body">
                    <input type="checkbox" name={name} value={o.value} className="size-5 accent-primary" />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            );
          }
          if (q.type === 'long_text') {
            return (
              <div key={q.key} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-caption text-ink-2">
                  {label(q)}
                </label>
                <textarea
                  id={id}
                  name={name}
                  required={q.required}
                  maxLength={2000}
                  rows={3}
                  className="rounded-card border border-line bg-surface px-4 py-2.5 text-body text-ink"
                />
              </div>
            );
          }
          const numeric = q.type === 'number' || q.type === 'count';
          return (
            <Input
              key={q.key}
              id={id}
              name={name}
              required={q.required}
              type={numeric ? 'number' : 'text'}
              min={q.type === 'count' ? Math.max(0, q.min ?? 0) : (q.min ?? undefined)}
              max={q.max ?? undefined}
              step={q.type === 'count' ? 1 : 'any'}
              maxLength={numeric ? undefined : 200}
              label={label(q)}
              hint={q.help ?? undefined}
              error={error(q.key)}
              onChange={(e) => set(q.key, numeric ? Number(e.target.value) : e.target.value)}
            />
          );
        })}
    </fieldset>
  );
}
