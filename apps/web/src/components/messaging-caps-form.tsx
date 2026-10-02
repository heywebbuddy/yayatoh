'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { CapsState } from '@/app/[locale]/o/[org]/(org)/messaging/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'field w-28';

/**
 * The org's frequency caps (M3.5a): one row per scope, two whole numbers each. Errors sit next to
 * their field; the outcome is announced. Native inputs (keyboard first).
 */
export function MessagingCapsForm({
  action,
  caps,
}: {
  action: (prev: CapsState, form: FormData) => Promise<CapsState>;
  caps: ReadonlyArray<{ scope: string; maxMessages: number; windowHours: number }>;
}) {
  const t = useTranslations('messagingHealth');
  const tr = useTranslations();
  const initial: CapsState = {
    saved: false,
    errors: {},
    code: null,
    values: Object.fromEntries(
      caps.flatMap((c) => [
        [`${c.scope}.max`, String(c.maxMessages)],
        [`${c.scope}.hours`, String(c.windowHours)],
      ]),
    ),
  };
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} noValidate aria-label={t('capsTitle')} className="flex flex-col gap-4">
      <div role="status" aria-live="polite">
        {state.saved ? <p className="text-body font-medium">{t('capsSaved')}</p> : null}
      </div>
      {state.code && state.code !== 'validation_failed' ? (
        <Alert title={tr(errorMessageKey(state.code))} />
      ) : null}
      {caps.map((c) => {
        const scope = t(`scope.${c.scope}`);
        const maxKey = `${c.scope}.max`;
        const hoursKey = `${c.scope}.hours`;
        const maxErr = state.errors[maxKey];
        const hoursErr = state.errors[hoursKey];
        return (
          <fieldset key={c.scope} className="flex flex-wrap items-end gap-3">
            <legend className="mb-1 text-[13px] font-bold text-ink">{scope}</legend>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`cap-${maxKey}`} className="text-[13px] font-bold text-ink">
                {t('maxMessages', { scope })}
              </label>
              <input
                id={`cap-${maxKey}`}
                name={maxKey}
                inputMode="numeric"
                defaultValue={state.values[maxKey]}
                aria-invalid={maxErr ? true : undefined}
                aria-describedby={maxErr ? `cap-${maxKey}-error` : undefined}
                className={`${field} ${maxErr ? 'field-invalid' : ''}`}
              />
              {maxErr ? (
                <p id={`cap-${maxKey}-error`} className="text-caption text-danger">
                  {t('maxInvalid')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`cap-${hoursKey}`} className="text-[13px] font-bold text-ink">
                {t('windowHours', { scope })}
              </label>
              <input
                id={`cap-${hoursKey}`}
                name={hoursKey}
                inputMode="numeric"
                defaultValue={state.values[hoursKey]}
                aria-invalid={hoursErr ? true : undefined}
                aria-describedby={hoursErr ? `cap-${hoursKey}-error` : undefined}
                className={`${field} ${hoursErr ? 'field-invalid' : ''}`}
              />
              {hoursErr ? (
                <p id={`cap-${hoursKey}-error`} className="text-caption text-danger">
                  {t('windowInvalid')}
                </p>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      <Button type="submit" disabled={pending} className="self-start">
        {t('saveCaps')}
      </Button>
    </form>
  );
}
