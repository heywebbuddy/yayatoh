import { type SignInOutcome, useCore } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { minutesFrom } from '../../enrol/minutes';
import { Body, Button, Heading, Notice, Screen, TextField } from '../../ui/kit';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = { readonly kind: 'credentials' } | { readonly kind: 'code'; readonly challenge: string };
/** A message from the shared catalog (`core`) or from this app's own, or a wait. */
type Problem =
  | { readonly kind: 'core' | 'own'; readonly key: string }
  | { readonly kind: 'wait'; readonly minutes: number };

/**
 * Organizer sign-in (M7.4a, P7-6): the account's email and password, then a code from the
 * authenticator app (or a backup code). Two-step verification is required: an account without it is
 * signed out again at once, because the event-day view shows live numbers for the whole event.
 */
export default function OrganizerSignIn() {
  const t = useTranslations('organizer');
  const core = useTranslations('core');
  const { signIn, session } = useCore();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: 'email' | 'password' | 'code'; key: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<Problem | null>(null);

  const show = (outcome: SignInOutcome): void => {
    switch (outcome.kind) {
      case 'rateLimited':
        setProblem({ kind: 'wait', minutes: minutesFrom(outcome.retryAfterSeconds) });
        return;
      case 'unavailable':
        setProblem({ kind: 'core', key: 'signIn.unavailable' });
        return;
      case 'failed':
        if (outcome.reason === 'invalid_challenge' || outcome.reason === 'too_many_attempts')
          setStep({ kind: 'credentials' });
        setProblem({ kind: 'core', key: `signIn.failed.${outcome.reason}` });
        return;
      default:
        setProblem({ kind: 'core', key: 'signIn.failed.unknown' });
    }
  };

  const submitCredentials = async () => {
    setProblem(null);
    if (!EMAIL.test(email.trim())) return setFieldError({ field: 'email', key: 'errors.emailInvalid' });
    if (!password) return setFieldError({ field: 'password', key: 'errors.passwordRequired' });
    setFieldError(null);
    setBusy(true);
    try {
      const outcome = await signIn.withPassword(email, password);
      if (outcome.kind === 'twoFactor') {
        setCode('');
        setStep({ kind: 'code', challenge: outcome.challenge });
      } else if (outcome.kind === 'signedIn') {
        // No second step was asked for: the account has none, and an organizer must.
        await session.signOut();
        setProblem({ kind: 'own', key: 'twoFactorRequired' });
      } else {
        show(outcome);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (challenge: string) => {
    setProblem(null);
    if (!code.trim()) return setFieldError({ field: 'code', key: 'errors.codeRequired' });
    setFieldError(null);
    setBusy(true);
    try {
      const outcome = await signIn.completeTwoFactor(challenge, code);
      if (outcome.kind === 'signedIn') router.replace('/');
      else show(outcome);
    } finally {
      setBusy(false);
    }
  };

  const message = !problem
    ? null
    : problem.kind === 'wait'
      ? core('signIn.rateLimited', { minutes: problem.minutes })
      : problem.kind === 'core'
        ? core(problem.key)
        : t(problem.key);

  return (
    <Screen testID="organizer-sign-in">
      <Heading>{t('title')}</Heading>
      {step.kind === 'credentials' ? (
        <>
          <Body muted>{t('intro')}</Body>
          <TextField
            autoComplete="email"
            error={fieldError?.field === 'email' ? t(fieldError.key) : null}
            keyboardType="email-address"
            label={t('email')}
            onChangeText={setEmail}
            testID="organizer-email"
            textContentType="username"
            value={email}
          />
          <TextField
            autoComplete="current-password"
            error={fieldError?.field === 'password' ? t(fieldError.key) : null}
            label={t('password')}
            onChangeText={setPassword}
            secureTextEntry
            testID="organizer-password"
            textContentType="password"
            value={password}
          />
          <Button
            busy={busy}
            label={t('continue')}
            onPress={() => void submitCredentials()}
            testID="organizer-continue"
          />
        </>
      ) : (
        <>
          <Body muted>{t('codeIntro')}</Body>
          <TextField
            autoComplete="one-time-code"
            error={fieldError?.field === 'code' ? t(fieldError.key) : null}
            keyboardType="number-pad"
            label={t('code')}
            onChangeText={setCode}
            testID="organizer-code"
            textContentType="oneTimeCode"
            value={code}
          />
          <Button
            busy={busy}
            label={t('verify')}
            onPress={() => void submitCode(step.challenge)}
            testID="organizer-verify"
          />
          <Button
            label={core('common.cancel')}
            onPress={() => {
              setStep({ kind: 'credentials' });
              setProblem(null);
            }}
            testID="organizer-cancel"
            variant="link"
          />
        </>
      )}
      {message ? (
        <Notice tone="danger" testID="organizer-error">
          {message}
        </Notice>
      ) : null}
      <Button label={t('back')} onPress={() => router.back()} testID="organizer-back" variant="link" />
    </Screen>
  );
}
