'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { type ForgotState, requestResetAction } from '@/app/[locale]/forgot-password/actions.ts';
import { type ResetState, resetPasswordAction } from '@/app/[locale]/reset-password/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { HumanCheckGroup, type HumanCheckWidget } from './human-check-field.tsx';

/** Email + the human check; always the same answer, known address or not. */
export function ForgotPasswordForm({
  humanCheck,
  locale,
}: {
  humanCheck: HumanCheckWidget | null;
  locale: string;
}) {
  const t = useTranslations('passwordReset');
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestResetAction, { code: null });
  // A challenge answer works once: a new widget after each try.
  const [tries, setTries] = useState(0);
  if (state.code === 'sent')
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title={t('sent')} />
        <Link href="/sign-in" className="self-start text-body underline underline-offset-4">
          {t('backToSignIn')}
        </Link>
      </div>
    );
  return (
    <form action={action} onSubmit={() => setTries((n) => n + 1)} className="flex flex-col gap-4" noValidate>
      <div aria-live="polite">
        {state.code ? <Alert title={t(`errors.${state.code}`, { minutes: state.minutes ?? 1 })} /> : null}
      </div>
      <Input
        name="email"
        type="email"
        autoComplete="email"
        required
        label={t('email')}
        aria-invalid={state.code === 'email' || undefined}
      />
      {humanCheck ? <HumanCheckGroup key={tries} widget={humanCheck} locale={locale} /> : null}
      <Button type="submit" disabled={pending}>
        {t('send')}
      </Button>
      <Link
        href="/sign-in"
        className="inline-flex min-h-6 items-center self-center text-caption underline underline-offset-4"
      >
        {t('backToSignIn')}
      </Link>
    </form>
  );
}

/** New password twice (8–128 characters). */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('passwordReset');
  const [state, action, pending] = useActionState<ResetState, FormData>(
    resetPasswordAction.bind(null, token),
    {
      code: null,
    },
  );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div aria-live="polite">{state.code ? <Alert title={t(`errors.${state.code}`)} /> : null}</div>
      <Input
        id="new-password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={128}
        label={t('newPassword')}
        hint={t('passwordHint')}
        aria-invalid={state.code === 'too_short' || state.code === 'too_long' || undefined}
      />
      <Input
        id="confirm-password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        label={t('confirmPassword')}
        aria-invalid={state.code === 'mismatch' || undefined}
      />
      <Button type="submit" disabled={pending}>
        {t('save')}
      </Button>
    </form>
  );
}
