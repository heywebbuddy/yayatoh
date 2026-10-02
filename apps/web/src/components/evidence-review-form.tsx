'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const SECTIONS = ['tickets', 'accessLog', 'refunds', 'messages', 'refundPolicy'] as const;
const field = 'w-full rounded-card border border-line bg-surface px-4 py-3 text-body';

/**
 * Review the evidence packet before it goes to the card network (M1.6e): write the statement,
 * choose the optional sections, save, and submit only after confirming the packet was read.
 */
export function EvidenceReviewForm({
  action,
  summary,
  excluded,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  summary: string;
  excluded: readonly string[];
}) {
  const t = useTranslations('disputes.review');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const summaryBad = state.fields?.includes('summary') ?? false;
  const error =
    state.code === null
      ? null
      : summaryBad
        ? t('summaryTooShort')
        : state.reason === 'not_reviewed'
          ? t('notReviewed')
          : state.reason === 'packet_too_large'
            ? t('tooLarge')
            : state.reason === 'provider_refused'
              ? t('providerRefused')
              : state.reason === 'dispute_not_open'
                ? t('notOpen')
                : te(errorMessageKey(state.code));
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="evidence-summary" className="text-caption text-ink-2">
          {t('summary')}
        </label>
        <textarea
          id="evidence-summary"
          name="summary"
          rows={6}
          maxLength={20_000}
          defaultValue={summary}
          aria-invalid={summaryBad || undefined}
          aria-describedby="evidence-summary-hint"
          className={field}
        />
        <p id="evidence-summary-hint" className="text-caption text-ink-2">
          {t('summaryHint')}
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-ink-2">{t('sections')}</legend>
        {SECTIONS.map((s) => (
          <label key={s} className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="checkbox"
              name="include"
              value={s}
              defaultChecked={!excluded.includes(s)}
              className="size-5"
            />
            {t(`section.${s}`)}
          </label>
        ))}
        <p className="text-caption text-ink-2">{t('sectionsHint')}</p>
      </fieldset>
      <label className="flex min-h-6 items-start gap-2 text-body">
        <input type="checkbox" name="reviewed" value="yes" className="mt-0.5 size-5 shrink-0" />
        {t('reviewed')}
      </label>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {error ? <Alert title={error} /> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
          {t('save')}
        </Button>
        <Button type="submit" name="intent" value="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
