'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/** Start a warehouse rebuild (M6.2a): one button, then a polite success or error message. */
export function RebuildAnalyticsForm({
  action,
  running,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  running: boolean;
}) {
  const t = useTranslations('warehouse');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || running}
        className="self-start"
        data-testid="analytics-rebuild"
      >
        {pending ? t('rebuilding') : t('rebuild')}
      </Button>
      <div aria-live="polite">
        {state.ok ? (
          <Alert tone="success" title={t('rebuildStarted')}>
            {t('rebuildStartedBody')}
          </Alert>
        ) : state.code ? (
          <Alert title={state.reason === 'running' ? t('rebuildRunning') : te(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </form>
  );
}
