'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import {
  type FakeConsentParams,
  type FakeConsentState,
  fakeCancelAction,
  fakeConsentAction,
} from '@/app/[locale]/auth/social/fake/actions.ts';

/** The fake provider's consent form: who is signing in, and the provider's claims about them. */
export function FakeConsentForm({
  provider,
  params,
}: {
  provider: 'google' | 'apple';
  params: FakeConsentParams;
}) {
  const t = useTranslations('fakeSocial');
  const [state, action, pending] = useActionState<FakeConsentState, FormData>(
    fakeConsentAction.bind(null, params),
    { code: null },
  );
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <div aria-live="polite">{state.code ? <Alert title={t(`errors.${state.code}`)} /> : null}</div>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          label={t('email')}
          error={state.code === 'email_required' ? t('errors.email_required') : undefined}
        />
        <Input name="name" autoComplete="name" label={t('name')} />
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="verified" value="yes" defaultChecked className="size-5" />
          {t('verified')}
        </label>
        {provider === 'apple' ? (
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input type="checkbox" name="hide" value="yes" className="size-5" />
            {t('hideEmail')}
          </label>
        ) : null}
        <Button type="submit" disabled={pending}>
          {t('continue')}
        </Button>
      </form>
      <form action={fakeCancelAction.bind(null, params)}>
        <Button type="submit" variant="ghost" className="w-full">
          {t('cancel')}
        </Button>
      </form>
    </div>
  );
}
