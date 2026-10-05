'use client';

import { REPORT_REASONS } from '@yayatoh/reviews/ui';
import { Alert, Button, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/** "Report" on a public review: opens a small form (reason, optional note) in place. */
export function ReportForm({
  action,
  author,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  author: string;
}) {
  const t = useTranslations('reviews.report');
  const tr = useTranslations('reviews.reportReasons');
  const te = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const id = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);
  if (state.ok)
    return (
      <p className="text-caption text-ink-2" role="status">
        {t('thanks')}
      </p>
    );
  if (!open)
    return (
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        {t('open')}
        <span className="sr-only"> {t('openFor', { name: author })}</span>
      </Button>
    );
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-card border border-line p-3">
      <label htmlFor={`${id}-reason`} className="text-[13px] font-bold text-ink">
        {t('reason')}
      </label>
      <Select ref={firstRef} id={`${id}-reason`} name="reason" className="field px-3">
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {tr(r)}
          </option>
        ))}
      </Select>
      <label htmlFor={`${id}-note`} className="text-[13px] font-bold text-ink">
        {t('note')}
      </label>
      <textarea
        id={`${id}-note`}
        name="note"
        rows={2}
        maxLength={500}
        className="rounded-card border border-line bg-surface px-4 py-2 text-body"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('submit')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
      <div aria-live="polite">
        {state.code ? (
          <Alert title={state.code === 'rate_limited' ? t('rateLimited') : te(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </form>
  );
}
