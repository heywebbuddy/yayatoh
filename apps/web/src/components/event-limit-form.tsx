'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/** The optional event-wide attendee limit: all ticket types together; empty = no event-wide limit. */
export function EventLimitForm({
  action,
  maxAttendees,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  maxAttendees: number | null;
}) {
  const t = useTranslations('eventLimit');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-3">
      <Input
        name="maxAttendees"
        inputMode="numeric"
        defaultValue={maxAttendees === null ? '' : String(maxAttendees)}
        label={t('label')}
        hint={t('hint')}
        error={
          state.fields?.includes('maxAttendees')
            ? t(state.reason === 'below_sold' ? 'belowSold' : 'invalid')
            : undefined
        }
      />
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !state.fields?.includes('maxAttendees') ? (
          <Alert title={te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
