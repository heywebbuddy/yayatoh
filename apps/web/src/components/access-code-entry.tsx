'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** "Have an access code?" on the public event page and the private-event gate (M1.4d). */
export function AccessCodeEntry({
  action,
  idPrefix = 'access',
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  idPrefix?: string;
}) {
  const t = useTranslations('accessEntry');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const error =
    state.code === 'rate_limited'
      ? t('rateLimited')
      : state.reason === 'invalid_code'
        ? t('invalid')
        : state.reason === 'empty'
          ? t('empty')
          : state.code
            ? te(errorMessageKey(state.code))
            : undefined;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <Input
          id={`${idPrefix}-code`}
          name="accessCode"
          label={t('label')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          error={state.code === 'rate_limited' ? undefined : error}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('submit')}
      </Button>
      <div aria-live="polite" className="w-full">
        {state.ok && !pending ? <Alert tone="info" title={t('accepted')} /> : null}
        {state.code === 'rate_limited' ? <Alert title={error} /> : null}
      </div>
    </form>
  );
}
