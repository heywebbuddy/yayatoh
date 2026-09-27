'use client';

import { authClient } from '@yayatoh/auth/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useRouter } from '@/i18n/navigation.ts';

type Mode = 'password' | 'code';

/** Email + password, or a one-time code by email (M1.2). Errors map to localized messages. */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations('signIn');
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    setBusy(true);
    setError(null);
    try {
      if (mode === 'password') {
        const { error: err } = await authClient.signIn.email({
          email,
          password: String(form.get('password') ?? ''),
        });
        if (err) return setError(t('invalid'));
      } else if (!codeSent) {
        const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
        if (err) return setError(t('failed'));
        return setCodeSent(true);
      } else {
        const { error: err } = await authClient.signIn.emailOtp({
          email,
          otp: String(form.get('otp') ?? ''),
        });
        if (err) return setError(t('invalidCode'));
      }
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Alert title={error} /> : null}
      <Input name="email" type="email" autoComplete="email" required label={t('email')} />
      {mode === 'password' ? (
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          label={t('password')}
        />
      ) : codeSent ? (
        <Input
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          label={t('code')}
          hint={t('codeHint')}
        />
      ) : null}
      <Button type="submit" disabled={busy}>
        {mode === 'password' ? t('submit') : codeSent ? t('verify') : t('sendCode')}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setMode(mode === 'password' ? 'code' : 'password');
          setCodeSent(false);
          setError(null);
        }}
      >
        {mode === 'password' ? t('useCode') : t('usePassword')}
      </Button>
    </form>
  );
}
