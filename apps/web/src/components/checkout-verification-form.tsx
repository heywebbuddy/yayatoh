'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/** The event's buyer email check (M1.5f): on by default; organizers may turn it off. */
export function CheckoutVerificationForm({
  action,
  verifyEmail,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  verifyEmail: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex min-h-6 items-start gap-2.5 text-body">
        <input
          type="checkbox"
          name="verifyEmail"
          value="1"
          defaultChecked={verifyEmail}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>{t('guestVerify.settingLabel')}</span>
      </label>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t('guestVerify.settingSave')}
        </Button>
      </div>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('guestVerify.settingSaved')} /> : null}
        {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      </div>
    </form>
  );
}
