'use client';

import { ENGAGEMENT_KINDS, type EngagementKind } from '@yayatoh/engagement/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useId } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type Weights = Readonly<Record<EngagementKind, number>>;

/**
 * The org's engagement weights (M5.7b): points per kind, 0–100. Read-only for people who may not
 * change org settings; saving rescored every attendee, so the page shows the new scores at once.
 */
export function WeightsForm({
  weights,
  custom,
  canEdit,
  save,
  reset,
}: {
  weights: Weights;
  custom: boolean;
  canEdit: boolean;
  save: (prev: FormState, form: FormData) => Promise<FormState>;
  reset: (prev: FormState) => Promise<FormState>;
}) {
  const t = useTranslations('engagement.scores');
  const te = useTranslations();
  const id = useId();
  const [state, saveAction, saving] = useActionState(save, INITIAL_FORM_STATE);
  const [resetState, resetAction, resetting] = useActionState(reset, INITIAL_FORM_STATE);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    // Keep what was typed when the server refuses it (React resets a form after its action).
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => saveAction(form));
  };
  const bad = (k: string) => state.fields?.includes(k);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-ink-2" data-testid="weights-source">
        {custom ? t('customWeights') : t('defaultWeights')}
      </p>
      <form onSubmit={submit} noValidate aria-label={t('weightsTitle')} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ENGAGEMENT_KINDS.map((k) => (
            <Input
              key={`${k}-${weights[k]}`}
              id={`${id}-${k}`}
              name={k}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              required
              defaultValue={weights[k]}
              disabled={!canEdit}
              label={t(`kinds.${k}`)}
              error={bad(k) ? t('weightInvalid') : undefined}
            />
          ))}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {t('saveWeights')}
            </Button>
            {custom ? (
              <Button
                type="button"
                variant="secondary"
                disabled={resetting}
                onClick={() => startTransition(() => resetAction())}
              >
                {t('resetWeights')}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-caption text-ink-2">{t('weightsReadOnly')}</p>
        )}
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('weightsSaved')} /> : null}
          {resetState.ok ? <Alert tone="info" title={t('weightsReset')} /> : null}
          {state.code && !state.fields?.length ? <Alert title={te(errorMessageKey(state.code))} /> : null}
          {resetState.code ? <Alert title={te(errorMessageKey(resetState.code))} /> : null}
        </div>
      </form>
    </div>
  );
}
