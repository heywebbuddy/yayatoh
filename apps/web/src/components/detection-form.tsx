'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { DetectionFormState } from '@/app/[locale]/o/[org]/e/[event]/onsite/signals/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** The event's velocity rule settings: human scan rate and walking speed between checkpoints. */
export function DetectionForm({
  action,
  maxScansPerMinute,
  maxTravelKmh,
}: {
  action: (prev: DetectionFormState, form: FormData) => Promise<DetectionFormState>;
  maxScansPerMinute: number;
  maxTravelKmh: number;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const fieldError = (field: string) =>
    state.kind === 'error' && state.field === field ? t(`signals.settings.${field}Error`) : undefined;
  return (
    <form action={formAction} noValidate className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input
        name="maxScansPerMinute"
        inputMode="numeric"
        defaultValue={String(maxScansPerMinute)}
        label={t('signals.settings.maxScansPerMinute')}
        hint={t('signals.settings.maxScansPerMinuteHint')}
        error={fieldError('maxScansPerMinute')}
      />
      <Input
        name="maxTravelKmh"
        inputMode="numeric"
        defaultValue={String(maxTravelKmh)}
        label={t('signals.settings.maxTravelKmh')}
        hint={t('signals.settings.maxTravelKmhHint')}
        error={fieldError('maxTravelKmh')}
      />
      <div className="flex flex-col gap-2 md:col-span-2">
        <div aria-live="polite">
          {state.kind === 'saved' ? <Alert tone="info" title={t('signals.settings.saved')} /> : null}
          {state.kind === 'error' && !state.field ? <Alert title={t(errorMessageKey(state.code))} /> : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('signals.settings.save')}
        </Button>
      </div>
    </form>
  );
}
