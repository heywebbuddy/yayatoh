'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import type { FakeIdpAnswer } from '@/app/[locale]/auth/sso/fake/actions.ts';

/**
 * The fake identity provider's sign-in form (dev, preview and CI). Its answer goes back to the app
 * like a real IdP's: a redirect (OIDC) or a form POST to the ACS (SAML). The POST form submits
 * itself once rendered; its button stays for keyboard and no-script use.
 */
export function FakeIdpForm({
  action,
  hidden,
  loginHint,
}: {
  action: (prev: FakeIdpAnswer, form: FormData) => Promise<FakeIdpAnswer>;
  hidden: Readonly<Record<string, string>>;
  loginHint: string;
}) {
  const t = useTranslations('ssoFakeIdp');
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' } as FakeIdpAnswer);
  const post = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.kind === 'redirect') window.location.assign(state.url);
    if (state.kind === 'post') post.current?.submit();
  }, [state]);
  if (state.kind === 'post')
    return (
      <form ref={post} method="post" action={state.url} className="flex flex-col gap-3">
        {Object.entries(state.fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <p role="status">{t('returning')}</p>
        <Button type="submit">{t('continue')}</Button>
      </form>
    );
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.kind === 'error' && state.error === 'unknown' ? <Alert title={t('unknown')} /> : null}
      <Input
        name="email"
        type="email"
        autoComplete="off"
        label={t('email')}
        defaultValue={loginHint}
        error={state.kind === 'error' && state.error === 'invalid_email' ? t('invalidEmail') : undefined}
      />
      <Input name="name" label={t('name')} autoComplete="off" />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="sign_in" disabled={pending}>
          {t('signIn')}
        </Button>
        <Button type="submit" name="intent" value="cancel" variant="ghost" disabled={pending}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
