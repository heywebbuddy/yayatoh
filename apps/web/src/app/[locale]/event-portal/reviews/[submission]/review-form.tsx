'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState } from 'react';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/** Score choices as large pill radios: arrow keys move within the group, 44 px targets. */
const PILL =
  'flex size-11 cursor-pointer items-center justify-center rounded-pill border border-line bg-surface font-mono text-body text-ink has-[:checked]:border-ink has-[:checked]:bg-tag has-[:checked]:text-tag-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus';

/**
 * A reviewer's score (1–5) and comment for one assigned proposal (M5.3b). Saving again replaces
 * the review until the organizer decides. Keyboard: Tab to the scale, arrows to choose.
 */
export function ReviewForm({
  action,
  score,
  comment,
}: {
  action: (prev: ProgramFormState, form: FormData) => Promise<ProgramFormState>;
  score: number | null;
  comment: string;
}) {
  const t = useTranslations('cfpReview');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as ProgramFormState);
  const scoreError = state.fields?.includes('score');
  const commentError = state.fields?.includes('comment');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <fieldset
        aria-describedby={scoreError ? 'score-hint score-error' : 'score-hint'}
        aria-invalid={scoreError ? true : undefined}
        className="flex flex-col gap-2 border-0 p-0"
      >
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('scoreLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((v) => (
            <label key={v} className={PILL}>
              <input type="radio" name="score" value={v} defaultChecked={score === v} className="sr-only" />
              <span aria-hidden="true">{v}</span>
              <span className="sr-only">{t('scoreOption', { n: v })}</span>
            </label>
          ))}
        </div>
        <p id="score-hint" className="m-0 text-caption text-ink-2">
          {t('scoreHint')}
        </p>
        {scoreError ? (
          <p id="score-error" className="m-0 text-caption text-danger">
            {t('errors.score')}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-comment" className="text-[13px] font-bold text-ink">
          {t('commentLabel')}
        </label>
        <textarea
          id="review-comment"
          name="comment"
          rows={5}
          maxLength={2000}
          defaultValue={comment}
          aria-describedby="comment-hint"
          aria-invalid={commentError ? true : undefined}
          className={`rounded-card border bg-surface px-4 py-2.5 text-body text-ink ${commentError ? 'field-invalid' : ''}`}
        />
        <p id="comment-hint" className="m-0 text-caption text-ink-2">
          {t('commentHint')}
        </p>
      </div>
      <div aria-live="polite">
        {state.ok && !pending ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !scoreError ? (
          <Alert
            title={
              state.reason && t.has(`errors.${state.reason}`)
                ? t(`errors.${state.reason}`)
                : tr(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-stretch sm:self-start">
        {score === null ? t('submit') : t('update')}
      </Button>
    </form>
  );
}
