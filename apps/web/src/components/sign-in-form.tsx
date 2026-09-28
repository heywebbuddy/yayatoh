'use client';

import { authClient } from '@yayatoh/auth/client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useActionState, useEffect, useId, useState } from 'react';
import { type ChallengeState, verifyChallengeAction } from '@/app/[locale]/sign-in/actions.ts';
import { useRouter } from '@/i18n/navigation.ts';

type Mode = 'password' | 'code';

/** Better Auth client errors carry the HTTP status and our 429 body (`retryAfter` seconds). */
type AuthError = { status?: number; retryAfter?: unknown } | null;

/**
 * Email + password, or a one-time code by email (M1.2). People with two-step verification then
 * enter a code from their authenticator app or a backup code (M1.2c). Errors map to localized
 * messages.
 */
export function SignInForm({ next, challenge = false }: { next: string; challenge?: boolean }) {
  const t = useTranslations('signIn');
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [step, setStep] = useState<'credentials' | 'challenge'>(challenge ? 'challenge' : 'credentials');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** A 429 from the rate limiter (M1.14a): say how long to wait, in the user's language. */
  const limited = (err: AuthError) => {
    if (err?.status !== 429) return false;
    const seconds = typeof err.retryAfter === 'number' ? err.retryAfter : 60;
    setError(t('rateLimited', { minutes: Math.max(1, Math.ceil(seconds / 60)) }));
    return true;
  };
  if (step === 'challenge')
    return (
      <ChallengeForm
        next={next}
        onRestart={() => {
          setStep('credentials');
          setCodeSent(false);
          setError(null);
        }}
      />
    );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    setBusy(true);
    setError(null);
    try {
      let twoFactor = false;
      if (mode === 'password') {
        const { data, error: err } = await authClient.signIn.email({
          email,
          password: String(form.get('password') ?? ''),
        });
        if (limited(err)) return;
        if (err) return setError(t('invalid'));
        twoFactor = Boolean((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect);
      } else if (!codeSent) {
        const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
        if (limited(err)) return;
        if (err) return setError(t('failed'));
        return setCodeSent(true);
      } else {
        const { data, error: err } = await authClient.signIn.emailOtp({
          email,
          otp: String(form.get('otp') ?? ''),
        });
        if (limited(err)) return;
        if (err) return setError(t('invalidCode'));
        twoFactor = Boolean((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect);
      }
      if (twoFactor) return setStep('challenge');
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    // POST even before hydration: a GET fallback would put the password in the URL (M1.14 ZAP).
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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

/** Second step: a code from the authenticator app, or a backup code (each works once). */
function ChallengeForm({ next, onRestart }: { next: string; onRestart: () => void }) {
  const t = useTranslations('signIn.challenge');
  const router = useRouter();
  const headingId = useId();
  const [kind, setKind] = useState<'totp' | 'backup_code'>('totp');
  const [state, formAction, pending] = useActionState<ChallengeState, FormData>(verifyChallengeAction, {
    ok: false,
    code: null,
  });
  useEffect(() => {
    if (!state.ok) return;
    router.replace(next);
    router.refresh();
  }, [state.ok, next, router]);
  const restart = state.code === 'too_many_attempts' || state.code === 'expired';
  return (
    <form action={formAction} aria-labelledby={headingId} className="flex flex-col gap-4" noValidate>
      <h2 id={headingId} className="text-section">
        {t('title')}
      </h2>
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
        hint={kind === 'backup_code' ? t('backupHint') : undefined}
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
