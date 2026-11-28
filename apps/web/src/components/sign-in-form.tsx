'use client';

import { authClient } from '@yayatoh/auth/client';
import { Alert, Button, Field, fieldClass, Input } from '@yayatoh/ui';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  type ChallengeState,
  skipChallengeOnTrustedDevice,
  verifyChallengeAction,
} from '@/app/[locale]/sign-in/actions.ts';
import { Link, useRouter } from '@/i18n/navigation.ts';
import { isEmailAddress } from '@/lib/email-address.ts';
import { continueToSiteAction, signOutHereAction } from '@/server/session-actions.ts';
import { HumanCheckGroup, type HumanCheckWidget } from './human-check-field.tsx';

type Mode = 'password' | 'code';

/** The show/hide password button inside the field: the date picker's trailing icon button. */
const REVEAL_BUTTON =
  'absolute inset-y-0 end-1.5 my-auto inline-grid size-8 cursor-pointer place-items-center rounded-tag text-ink-2 hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus';

/** Better Auth client errors carry the HTTP status and our 429 body (`retryAfter` seconds). */
type AuthError = { status?: number; retryAfter?: unknown; code?: unknown } | null;

/** Signing in for a tenant site (M1.2d): where to hand the person back to. */
export interface Handoff {
  readonly returnUrl: string;
  readonly state: string;
  /** The site's host, shown to the person. */
  readonly site: string;
}

/**
 * After signing in: back to the tenant site with a one-time code when signing in for one, else
 * to `next` on this host.
 */
function useFinish(next: string, handoff: Handoff | undefined) {
  const router = useRouter();
  return async () => {
    if (handoff) {
      const r = await continueToSiteAction(handoff.returnUrl, handoff.state);
      if (r.url) {
        window.location.assign(r.url);
        return;
      }
    }
    router.replace(next);
    router.refresh();
  };
}

/**
 * Email + password, or a one-time code by email (M1.2). People with two-step verification then
 * enter a code from their authenticator app or a backup code (M1.2c). Errors map to localized
 * messages. Signing in for a tenant site hands the person back there (M1.2d).
 */
export function SignInForm({
  initialMode = 'password',
  allowModeSwitch = true,
  next,
  challenge = false,
  handoff,
  humanCheck = null,
  locale,
}: {
  initialMode?: Mode;
  allowModeSwitch?: boolean;
  next: string;
  challenge?: boolean;
  handoff?: Handoff;
  /** The "are you a person?" widget (M1.2f), or null when none is configured. */
  humanCheck?: HumanCheckWidget | null;
  locale?: string;
}) {
  const t = useTranslations('signIn');
  const finish = useFinish(next, handoff);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<'credentials' | 'challenge'>(challenge ? 'challenge' : 'credentials');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  // M1.2f: the check is always asked before a code is emailed, and for passwords after failures.
  const [needHuman, setNeedHuman] = useState(false);
  const [humanToken, setHumanToken] = useState('');
  const [humanKey, setHumanKey] = useState(0);
  const showHuman =
    Boolean(humanCheck) && ((mode === 'code' && !codeSent) || (mode === 'password' && needHuman));
  const fetchOptions = () => ({
    headers: humanToken ? { 'x-human-check': humanToken } : undefined,
    onError: (ctx: { response: Response }) => {
      if (ctx.response.headers.get('x-human-check') === 'required') setNeedHuman(true);
    },
  });
  /** The check was refused or missing (403 from the route): say which, and show a fresh one. */
  const humanRefused = (err: AuthError) => {
    if (err?.status !== 403) return false;
    setNeedHuman(true);
    setError(err.code === 'HUMAN_CHECK_FAILED' ? t('humanFailed') : t('humanRequired'));
    return true;
  };

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
        finish={finish}
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
    const email = String(form.get('email') ?? '').trim();
    const emailField = e.currentTarget.elements.namedItem('email');
    // QA #12: an address like "nitin@gmail" is named at the field (the auth route refuses it too).
    const showEmailError = () => {
      setError(null);
      setEmailError(t('invalidEmail'));
      if (emailField instanceof HTMLInputElement) emailField.focus();
    };
    const badEmail = (err: AuthError) => {
      if (err?.code !== 'INVALID_EMAIL') return false;
      showEmailError();
      return true;
    };
    // Hidden again on submit, so password managers see a password field when they offer to save.
    setShowPassword(false);
    if (!isEmailAddress(email)) return showEmailError();
    setEmailError(null);
    setBusy(true);
    setError(null);
    const usedHuman = Boolean(humanToken);
    try {
      let twoFactor = false;
      if (mode === 'password') {
        const { data, error: err } = await authClient.signIn.email(
          { email, password: String(form.get('password') ?? '') },
          fetchOptions(),
        );
        if (limited(err) || humanRefused(err) || badEmail(err)) return;
        if (err) return setError(t('invalid'));
        twoFactor = Boolean((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect);
      } else if (!codeSent) {
        if (humanCheck && !humanToken) return setError(t('humanRequired'));
        const { error: err } = await authClient.emailOtp.sendVerificationOtp(
          { email, type: 'sign-in' },
          fetchOptions(),
        );
        if (limited(err) || humanRefused(err) || badEmail(err)) return;
        if (err) return setError(t('failed'));
        return setCodeSent(true);
      } else {
        const { data, error: err } = await authClient.signIn.emailOtp({
          email,
          otp: String(form.get('otp') ?? ''),
        });
        if (limited(err) || badEmail(err)) return;
        if (err) return setError(t('invalidCode'));
        twoFactor = Boolean((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect);
      }
      if (twoFactor) return setStep('challenge');
      await finish();
    } finally {
      setBusy(false);
      // A challenge answer works once: a new widget for the next try.
      if (usedHuman) {
        setHumanToken('');
        setHumanKey((k) => k + 1);
      }
    }
  }

  return (
    // POST even before hydration: a GET fallback would put the password in the URL (M1.14 ZAP).
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Alert title={error} /> : null}
      <Input
        name="email"
        type="email"
        autoComplete="email"
        required
        label={t('email')}
        placeholder={t('emailPlaceholder')}
        error={emailError ?? undefined}
      />
      {mode === 'password' ? (
        <Field id="password" label={t('password')} required>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder={t('passwordPlaceholder')}
              className={fieldClass('md', 'field-trailing w-full')}
            />
            {/* The name is text inside the button: "Password" stays the field's only label. */}
            <button
              type="button"
              aria-controls="password"
              onClick={() => setShowPassword((s) => !s)}
              className={REVEAL_BUTTON}
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
              <span className="sr-only">{showPassword ? t('hidePassword') : t('showPassword')}</span>
            </button>
          </div>
        </Field>
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
      {showHuman && humanCheck ? (
        <HumanCheckGroup key={humanKey} widget={humanCheck} onToken={setHumanToken} locale={locale} />
      ) : null}
      <Button type="submit" disabled={busy}>
        {mode === 'password' ? t('submit') : codeSent ? t('verify') : t('sendCode')}
      </Button>
      {allowModeSwitch ? (
        <Button
          variant="ghost"
          onClick={() => {
            setMode(mode === 'password' ? 'code' : 'password');
            setCodeSent(false);
            setError(null);
            setEmailError(null);
          }}
        >
          {mode === 'password' ? t('useCode') : t('usePassword')}
        </Button>
      ) : null}
      {mode === 'password' ? (
        <Link
          href="/forgot-password"
          className="inline-flex min-h-10 items-center rounded-pill px-3.5 text-body font-bold text-ink-2 hover:bg-surface-3 hover:text-ink self-center"
        >
          {t('forgot')}
        </Link>
      ) : null}
    </form>
  );
}

/** Second step: a code from the authenticator app, or a backup code (each works once). */
function ChallengeForm({ finish, onRestart }: { finish: () => Promise<void>; onRestart: () => void }) {
  const t = useTranslations('signIn.challenge');
  const headingId = useId();
  const [kind, setKind] = useState<'totp' | 'backup_code'>('totp');
  const [state, formAction, pending] = useActionState<ChallengeState, FormData>(verifyChallengeAction, {
    ok: false,
    code: null,
  });
  const finished = useRef(false);
  // M1.2f: a browser this person trusts skips the code; otherwise the form shows.
  const [checking, setChecking] = useState(true);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    let live = true;
    skipChallengeOnTrustedDevice()
      .catch(() => false)
      .then((skipped) => {
        if (!live) return;
        if (skipped && !finished.current) {
          finished.current = true;
          void finishRef.current();
          return;
        }
        setChecking(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!state.ok || finished.current) return;
    finished.current = true;
    void finish();
  }, [state.ok, finish]);
  const restart = state.code === 'too_many_attempts' || state.code === 'expired';
  if (checking)
    return (
      <p role="status" className="text-body text-ink-2">
        {t('checking')}
      </p>
    );
  return (
    <form action={formAction} aria-labelledby={headingId} className="flex flex-col gap-4" noValidate>
      <h2 id={headingId} className="text-section">
        {t('title')}
      </h2>
      <p className="text-body text-ink-2">{kind === 'totp' ? t('explainTotp') : t('explainBackup')}</p>
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
      <label className="flex min-h-6 items-center gap-2 text-body">
        <input type="checkbox" name="trust" value="yes" className="size-5" />
        {t('trust')}
      </label>
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

/**
 * Already signed in on the app host, asked to sign in for a tenant site (M1.2d): continue as this
 * account (a one-time code takes the person back), or sign out here and use another one.
 */
export function ContinueToSite({ handoff, name, email }: { handoff: Handoff; name: string; email: string }) {
  const t = useTranslations('signIn.handoff');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-2">{t('signedInAs', { name, email })}</p>
      <div aria-live="polite">{failed ? <Alert title={t('failed', { site: handoff.site })} /> : null}</div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const r = await continueToSiteAction(handoff.returnUrl, handoff.state);
          if (r.url) return window.location.assign(r.url);
          setFailed(true);
          setBusy(false);
        }}
      >
        {t('continue', { site: handoff.site })}
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOutHereAction();
          router.refresh();
          setBusy(false);
        }}
      >
        {t('otherAccount')}
      </Button>
    </div>
  );
}
