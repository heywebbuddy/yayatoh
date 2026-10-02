'use client';

import { REVIEW_BODY_MAX } from '@yayatoh/reviews/ui';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/**
 * The buyer's review from their order page (M1.4g): a 1–5 rating as radio buttons (arrow keys
 * move between them) and optional plain text.
 */
export function ReviewForm({ action }: { action: (prev: FormState, form: FormData) => Promise<FormState> }) {
  const t = useTranslations('reviews.form');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [length, setLength] = useState(0);
  const bad = new Set(state.fields ?? []);
  const message =
    state.code === 'rate_limited'
      ? t('rateLimited')
      : state.reason === 'already_reviewed'
        ? t('already')
        : state.reason === 'not_ended'
          ? t('notEnded')
          : state.code && !bad.size
            ? te(errorMessageKey(state.code))
            : null;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4" noValidate>
      <fieldset
        aria-describedby={bad.has('rating') ? 'review-rating-error' : undefined}
        className="flex flex-col gap-2"
      >
        <legend className="text-caption text-ink-2">{t('rating')}</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-pill border border-line px-3 has-[:checked]:border-ink has-[:focus-visible]:outline-2"
            >
              <input type="radio" name="rating" value={n} required className="size-4 accent-primary" />
              {t('stars', { count: n })}
            </label>
          ))}
        </div>
        {bad.has('rating') ? (
          <p id="review-rating-error" className="text-caption text-danger">
            {t('ratingError')}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-body" className="text-caption text-ink-2">
          {t('body')}
        </label>
        <textarea
          id="review-body"
          name="body"
          rows={4}
          maxLength={REVIEW_BODY_MAX}
          onChange={(e) => setLength(e.target.value.length)}
          aria-invalid={bad.has('body') || undefined}
          aria-describedby="review-body-hint"
          className={`rounded-card border bg-surface px-4 py-2 text-body ${bad.has('body') ? 'border-danger' : 'border-line'}`}
        />
        <p id="review-body-hint" className={`text-caption ${bad.has('body') ? 'text-danger' : 'text-ink-2'}`}>
          {bad.has('body')
            ? t('bodyError', { max: REVIEW_BODY_MAX })
            : t('bodyHint', { count: length, max: REVIEW_BODY_MAX })}
        </p>
      </div>
      <div aria-live="polite">{message ? <Alert title={message} /> : null}</div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
