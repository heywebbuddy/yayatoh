'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SsoStartState } from '@/app/[locale]/sign-in/sso/actions.ts';

/** The work address whose organization's identity provider signs the person in (M6.5a). */
export function SsoSignInForm({
  action,
}: {
  action: (prev: SsoStartState, form: FormData) => Promise<SsoStartState>;
}) {
  const t = useTranslations('signIn.sso');
  const [state, formAction, pending] = useActionState(action, { error: null } as SsoStartState);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.error && state.error !== 'invalid_email' ? (
        <div aria-live="polite">
          <Alert title={t(`errors.${state.error}`)} />
        </div>
      ) : null}
      <Input
        name="email"
        type="email"
        autoComplete="email"
        required
        label={t('email')}
        hint={t('emailHint')}
        error={state.error === 'invalid_email' ? t('errors.invalid_email') : undefined}
      />
      <Button type="submit" disabled={pending}>
        {t('continue')}
      </Button>
    </form>
  );
}
