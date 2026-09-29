'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function useError(state: FormState): string | null {
  const t = useTranslations('waitlist.console');
  const tr = useTranslations();
  if (!state.code) return null;
  if (state.reason && t.has(`errors.${state.reason}`)) return t(`errors.${state.reason}`);
  return tr(errorMessageKey(state.code));
}

/** A list's settings: automatic offers on or paused, and how long an offer holds its tickets. */
export function WaitlistSettingsForm({
  action,
  autoOffer,
  offerHours,
}: {
  action: Action;
  autoOffer: boolean;
  offerHours: number;
}) {
  const t = useTranslations('waitlist.console');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const error = useError(state);
  return (
    <form action={formAction} aria-label={t('settingsLabel')} className="flex flex-col gap-3">
      <label className="flex min-h-6 items-start gap-2.5 text-body">
        <input
          type="checkbox"
          name="autoOffer"
          value="1"
          defaultChecked={autoOffer}
          className="mt-0.5 size-5 shrink-0 accent-ink"
        />
        <span>{t('autoOffer')}</span>
      </label>
      <div className="max-w-48">
        <Input
          name="offerHours"
          inputMode="decimal"
          defaultValue={String(offerHours)}
          label={t('offerHours')}
          hint={t('offerHoursHint')}
          error={state.fields?.includes('offerHours') ? t('errors.offerHours') : undefined}
        />
      </div>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {t('save')}
        </Button>
      </div>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {error && !state.fields?.includes('offerHours') ? <Alert title={error} /> : null}
      </div>
    </form>
  );
}

/** A row action (offer now, remove), labelled with the person it acts on. */
export function WaitlistRowAction({
  action,
  label,
  srLabel,
}: {
  action: Action;
  label: string;
  srLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const error = useError(state);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-label={srLabel}>
        {label}
      </Button>
      <span aria-live="assertive" className="text-caption text-pink-700">
        {error}
      </span>
    </form>
  );
}
