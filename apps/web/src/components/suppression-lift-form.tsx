'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { LiftState } from '@/app/[locale]/o/[org]/(org)/messaging/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Lift one bounce suppression: a required note, then "Lift" (M3.5a; audited without the address). */
export function SuppressionLiftForm({
  action,
  id,
  address,
}: {
  action: (prev: LiftState, form: FormData) => Promise<LiftState>;
  id: string;
  address: string;
}) {
  const t = useTranslations('messagingHealth');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, { error: null, note: '' });
  const inputId = `lift-note-${id}`;
  const message =
    state.error === 'note'
      ? t('noteRequired')
      : state.error === 'complaint_not_liftable'
        ? t('supportOnly')
        : state.error
          ? tr(errorMessageKey(state.error))
          : null;
  return (
    <form action={formAction} noValidate className="flex flex-wrap items-start gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-[13px] font-bold text-ink">
          {t('liftNote', { address })}
        </label>
        <input
          id={inputId}
          name="note"
          defaultValue={state.note}
          maxLength={500}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${inputId}-error` : undefined}
          className="field"
        />
        {message ? (
          <p id={`${inputId}-error`} role="alert" className="text-caption text-danger">
            {message}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-label={t('liftLabel', { address })}
        className="mt-5"
      >
        {t('lift')}
      </Button>
    </form>
  );
}
