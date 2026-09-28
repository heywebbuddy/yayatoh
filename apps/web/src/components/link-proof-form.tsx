'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId } from 'react';
import { confirmLinkAction, type LinkProofState } from '@/app/[locale]/sign-in/link/actions.ts';
import { Link } from '@/i18n/navigation.ts';

/** Type the code sent to the account's address; then on to the console, the second step or the site. */
export function LinkProofForm({
  target,
}: {
  target: { next: string; returnUrl: string | null; state: string | null };
}) {
  const t = useTranslations('socialLink');
  const errorId = useId();
  const [state, action, pending] = useActionState<LinkProofState, FormData>(
    confirmLinkAction.bind(null, target),
    {
      url: null,
      code: null,
    },
  );
  useEffect(() => {
    if (state.url) window.location.assign(state.url);
  }, [state.url]);
  const over =
    state.code === 'expired' || state.code === 'too_many_attempts' || state.code === 'linked_elsewhere';
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div id={errorId} aria-live="polite">
        {state.code ? <Alert title={t(`errors.${state.code}`)} /> : null}
      </div>
      <Input
        id="link-code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
        autoFocus
        label={t('codeLabel')}
        hint={t('codeHint')}
        aria-invalid={state.code === 'invalid_code' || undefined}
      />
      {over ? (
        <Link href="/sign-in" className="self-start text-body underline underline-offset-4">
          {t('startOver')}
        </Link>
      ) : (
        <Button type="submit" disabled={pending || Boolean(state.url)}>
          {t('confirm')}
        </Button>
      )}
    </form>
  );
}
