'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SignalActionState } from '@/app/[locale]/o/[org]/e/[event]/onsite/signals/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Act = (prev: SignalActionState, form: FormData) => Promise<SignalActionState>;

/**
 * Acknowledge or dismiss one open signal, with a note (M1.9e: required to dismiss). One form,
 * two submit buttons, so Enter in the note acknowledges. Keyed by the signal, so the
 * confirmation stays after the list re-renders with the new status.
 */
export function SignalActions({
  signalId,
  open,
  label,
  action,
}: {
  signalId: string;
  open: boolean;
  /** What the signal is, for the buttons' accessible names. */
  label: string;
  action: Act;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const noteError = state.kind === 'error' && state.field === 'note';
  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <form action={formAction} className="flex flex-col gap-2" noValidate>
          <Input
            id={`signal-note-${signalId}`}
            name="note"
            label={t('fraudSignals.note.label')}
            hint={t('fraudSignals.note.hint')}
            error={noteError ? t('fraudSignals.note.required') : undefined}
            maxLength={500}
            autoComplete="off"
            defaultValue={state.kind === 'error' ? state.note : ''}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="status"
              value="acknowledged"
              variant="secondary"
              size="sm"
              disabled={pending}
              aria-label={t('signals.acknowledgeFor', { what: label })}
            >
              {t('signals.acknowledge')}
            </Button>
            <Button
              type="submit"
              name="status"
              value="dismissed"
              variant="ghost"
              size="sm"
              disabled={pending}
              aria-label={t('signals.dismissFor', { what: label })}
            >
              {t('signals.dismiss')}
            </Button>
          </div>
        </form>
      ) : null}
      <div aria-live="polite">
        {state.kind === 'done' ? <Alert tone="info" title={t(`signals.done.${state.status}`)} /> : null}
        {state.kind === 'error' && !noteError ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      </div>
    </div>
  );
}
