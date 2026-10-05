'use client';

import { FEEDBACK_REASONS } from '@yayatoh/cms/ui';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * "Was this article helpful?" (M3.11b): Yes / No as two submit buttons (works without
 * JavaScript too); after a No, an optional "what was wrong?" follow-up. The answer is announced.
 */
export function HelpFeedbackForm({
  action,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('help.feedback');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const answered = state.ok ? state.reason : undefined;
  return (
    <section
      aria-labelledby="help-feedback-title"
      className="flex flex-col gap-3 rounded-card border border-line p-4"
    >
      <h2 id="help-feedback-title" className="text-body font-medium">
        {t('question')}
      </h2>
      {answered === undefined ? (
        <form action={formAction} className="flex flex-wrap gap-2">
          <Button type="submit" name="helpful" value="yes" variant="secondary" disabled={pending}>
            {t('yes')}
          </Button>
          <Button type="submit" name="helpful" value="no" variant="secondary" disabled={pending}>
            {t('no')}
          </Button>
        </form>
      ) : null}
      {answered === 'no' ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="helpful" value="no" />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-body text-ink-2">{t('reasonLegend')}</legend>
            {FEEDBACK_REASONS.map((r) => (
              <label key={r} className="flex min-h-6 items-center gap-2 text-body">
                <input type="radio" name="reason" value={r} className="size-5" />
                {t(`reason.${r}`)}
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {t('sendReason')}
          </Button>
        </form>
      ) : null}
      <div aria-live="polite">
        {answered ? (
          <p role="status" className="text-body text-ink-2">
            {t(answered === 'yes' ? 'thanksYes' : 'thanksNo')}
          </p>
        ) : null}
        {state.code === 'rate_limited' ? (
          <Alert title={t('rateLimited', { minutes: Number(state.reason ?? 1) })} />
        ) : state.code ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </section>
  );
}
