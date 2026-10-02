'use client';

import { FIELD_TYPES } from '@yayatoh/forms/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { TicketFormState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function QuestionForm({
  action,
}: {
  action: (prev: TicketFormState, form: FormData) => Promise<TicketFormState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [type, setType] = useState<string>('short_text');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setType('short_text');
    }
  }, [state]);
  const choice = type === 'select' || type === 'multi_select';
  return (
    <form ref={ref} action={formAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input name="label" required maxLength={200} label={t('questions.label')} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="question-type" className="text-[13px] font-bold text-ink">
          {t('questions.type')}
        </label>
        <select
          id="question-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="field"
        >
          {FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {t(`questions.types.${ft}`)}
            </option>
          ))}
        </select>
      </div>
      {choice ? (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label htmlFor="question-options" className="text-[13px] font-bold text-ink">
            {t('questions.options')}
          </label>
          <textarea
            id="question-options"
            name="options"
            rows={3}
            required
            maxLength={2000}
            aria-describedby="question-options-hint"
            className="rounded-card border border-line bg-surface px-4 py-2.5 text-body"
          />
          <p id="question-options-hint" className="text-caption text-ink-2">
            {t('questions.optionsHint')}
          </p>
        </div>
      ) : null}
      {type === 'count' || type === 'number' ? (
        <Input name="max" type="number" min={0} max={100000} label={t('questions.max')} />
      ) : null}
      <div className="flex flex-col gap-2 md:col-span-2">
        <label className="flex min-h-6 items-center gap-2.5 text-body">
          <input type="checkbox" name="required" value="1" className="size-5 accent-primary" />
          {t('questions.required')}
        </label>
        <label className="flex min-h-6 items-start gap-2.5 text-body">
          <input
            type="checkbox"
            name="sensitive"
            value="1"
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span>
            {t('questions.sensitive')}
            <span className="block text-caption text-ink-2">{t('questions.sensitiveHint')}</span>
          </span>
        </label>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('questions.added')} /> : null}
          {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('questions.add')}
        </Button>
      </div>
    </form>
  );
}
