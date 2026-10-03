'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

type Act = (prev: FormState, form: FormData) => Promise<FormState>;

/** Hide (or show again) with a reason the audit log keeps; dismiss open reports. */
export function ReviewModeration({
  id,
  hidden,
  openReports,
  hide,
  unhide,
  dismiss,
}: {
  id: string;
  hidden: boolean;
  openReports: number;
  hide: Act;
  unhide: Act;
  dismiss: Act;
}) {
  const t = useTranslations('reviews.console');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(hidden ? unhide : hide, INITIAL_FORM_STATE);
  const [dState, dismissAction, dPending] = useActionState(dismiss, INITIAL_FORM_STATE);
  const bad = new Set(state.fields ?? []);
  const inputId = `moderate-reason-${id}`;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <form
        action={formAction}
        onSubmit={keepValues(formAction)}
        className="flex flex-wrap items-end gap-2"
        noValidate
      >
        <div className="min-w-0 flex-1 basis-60">
          <Input
            id={inputId}
            name="reason"
            required
            minLength={3}
            maxLength={300}
            label={hidden ? t('unhideReason') : t('hideReason')}
            error={bad.has('reason') ? t('reasonError') : undefined}
          />
        </div>
        <Button type="submit" variant={hidden ? 'secondary' : 'primary'} disabled={pending}>
          {hidden ? t('unhide') : t('hide')}
        </Button>
      </form>
      {openReports > 0 ? (
        <form action={dismissAction}>
          <Button type="submit" variant="ghost" size="sm" disabled={dPending}>
            {t('dismissReports')}
          </Button>
        </form>
      ) : null}
      <div aria-live="polite">
        {state.code && !bad.has('reason') ? <Alert title={te(errorMessageKey(state.code))} /> : null}
        {dState.code ? <Alert title={te(errorMessageKey(dState.code))} /> : null}
      </div>
    </div>
  );
}
