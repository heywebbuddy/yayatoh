'use client';

import { authClient } from '@yayatoh/auth/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useActionState, useEffect, useState } from 'react';
import { type ChallengeState, verifyChallengeAction } from '@/app/sign-in/actions.ts';

/**
 * Staff sign in with their existing account; the console then checks the staff list. People with
 * two-step verification then enter a code from their authenticator app or a backup code.
 */
export function SignInForm() {
  const t = useTranslations('signIn');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  if (challenge) return <ChallengeForm onRestart={() => setChallenge(false)} />;
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await authClient.signIn.email({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      if (err) return setError(t('invalid'));
      if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return setChallenge(true);
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

function ChallengeForm({ onRestart }: { onRestart: () => void }) {
  const t = useTranslations('signIn.challenge');
  const router = useRouter();
  const [kind, setKind] = useState<'totp' | 'backup_code'>('totp');
  const [state, formAction, pending] = useActionState<ChallengeState, FormData>(verifyChallengeAction, {
    ok: false,
    code: null,
  });
  useEffect(() => {
    if (!state.ok) return;
    router.replace('/');
    router.refresh();
  }, [state.ok, router]);
  const restart = state.code === 'too_many_attempts' || state.code === 'expired';
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <h2 className="text-section">{t('title')}</h2>
      <p className="text-body text-zinc-600">{kind === 'totp' ? t('explainTotp') : t('explainBackup')}</p>
      <div aria-live="polite">{state.code ? <Alert title={t(`errors.${state.code}`)} /> : null}</div>
      <input type="hidden" name="kind" value={kind} />
      <Input
        key={kind}
        id={`challenge-${kind}`}
        name="code"
        inputMode={kind === 'totp' ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        required
        autoFocus
        label={kind === 'totp' ? t('totpLabel') : t('backupLabel')}
      />
      {restart ? (
        <Button onClick={onRestart}>{t('startOver')}</Button>
      ) : (
        <Button type="submit" disabled={pending || state.ok}>
          {t('verify')}
        </Button>
      )}
      <Button variant="ghost" onClick={() => setKind(kind === 'totp' ? 'backup_code' : 'totp')}>
        {kind === 'totp' ? t('useBackup') : t('useTotp')}
      </Button>
    </form>
  );
}
