'use client';

import { authClient } from '@yayatoh/auth/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

/** Staff sign in with their existing account; the console then checks the staff list. */
export function SignInForm() {
  const t = useTranslations('signIn');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.signIn.email({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      if (err) return setError(t('invalid'));
      router.replace('/');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Alert title={error} /> : null}
      <Input name="email" type="email" autoComplete="email" required label={t('email')} />
      <Input name="password" type="password" autoComplete="current-password" required label={t('password')} />
      <Button type="submit" disabled={busy}>
        {t('submit')}
      </Button>
    </form>
  );
}
