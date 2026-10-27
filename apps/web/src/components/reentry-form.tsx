'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { DetectionFormState } from '@/app/[locale]/o/[org]/e/[event]/onsite/signals/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Re-entry: let a ticket be scanned in again N hours after its last entry (off by default). */
export function ReentryForm({
  action,
  hours,
}: {
  action: (prev: DetectionFormState, form: FormData) => Promise<DetectionFormState>;
  /** The saved window, or null while re-entry is off. */
  hours: number | null;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const [on, setOn] = useState(hours !== null);
  const [value, setValue] = useState(String(hours ?? 3));
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <label className="flex min-h-6 items-start gap-2.5 text-body">
        <input
          type="checkbox"
          name="enabled"
          checked={on}
          onChange={(e) => setOn(e.currentTarget.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>{t('signals.reentry.enabled')}</span>
      </label>
      <Input
        name="hours"
        inputMode="numeric"
        value={value}
        disabled={!on}
        onChange={(e) => setValue(e.target.value)}
        label={t('signals.reentry.hours')}
        hint={t('signals.reentry.hoursHint')}
        error={
          state.kind === 'error' && state.field === 'hours' ? t('signals.reentry.hoursError') : undefined
        }
      />
      <div aria-live="polite">
        {state.kind === 'saved' ? <Alert tone="info" title={t('signals.reentry.saved')} /> : null}
        {state.kind === 'error' && !state.field ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('signals.reentry.save')}
      </Button>
    </form>
  );
}
