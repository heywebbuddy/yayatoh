import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { minutesFrom } from '../../enrol/minutes';
import { inviteTokenFrom, usePortal } from '../../portal';
import { Body, Button, Heading, Notice, Screen, TextField } from '../../ui/kit';

type Problem =
  | { readonly kind: 'core' | 'own'; readonly key: string }
  | { readonly kind: 'wait'; readonly minutes: number }
  | { readonly kind: 'attempts'; readonly left: number | null };

/**
 * Exhibitor sign-in (M7.4a, P7-6): the rep pastes the invitation link from their email, asks for a
 * six-digit code (emailed to the invited address) and types it. A right code opens a portal session
 * for lead retrieval at that one event. The invitation stays in memory; only the session is kept.
 */
export default function ExhibitorSignIn() {
  const t = useTranslations('exhibitor');
  const core = useTranslations('core');
  const portal = usePortal();
  const router = useRouter();
  const [invite, setInvite] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: 'invite' | 'code'; key: string } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const requestCode = async (inviteToken: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await portal.requestCode(inviteToken);
      if (outcome.kind === 'sent' || outcome.kind === 'cooldown') {
        setToken(inviteToken);
        setChallengeId(outcome.challengeId);
        setCode('');
      } else if (outcome.kind === 'invalid_invite') {
        setProblem({ kind: 'own', key: 'errors.invalidInvite' });
      } else if (outcome.kind === 'rateLimited') {
        setProblem({ kind: 'wait', minutes: minutesFrom(outcome.retryAfterSeconds) });
      } else {
        setProblem({ kind: 'core', key: 'signIn.unavailable' });
      }
    } finally {
      setBusy(false);
    }
  };

  const submitInvite = () => {
    const inviteToken = inviteTokenFrom(invite);
    if (!inviteToken) return setFieldError({ field: 'invite', key: 'errors.inviteInvalid' });
    setFieldError(null);
    void requestCode(inviteToken);
  };

  const submitCode = async () => {
    if (!token || !challengeId) return;
    setProblem(null);
    if (!/^\s*\d{3}\s?\d{3}\s*$/.test(code))
      return setFieldError({ field: 'code', key: 'errors.codeInvalid' });
    setFieldError(null);
    setBusy(true);
    try {
      const outcome = await portal.verifyCode(token, challengeId, code);
      switch (outcome.kind) {
        case 'signedIn':
          router.replace('/');
          return;
        case 'wrong_code':
          setProblem({ kind: 'attempts', left: outcome.attemptsLeft });
          return;
        case 'code_rejected':
          setChallengeId(null);
          setProblem({ kind: 'own', key: 'errors.codeRejected' });
          return;
        case 'invalid_invite':
          setToken(null);
          setChallengeId(null);
          setProblem({ kind: 'own', key: 'errors.invalidInvite' });
          return;
        case 'rateLimited':
          setProblem({ kind: 'wait', minutes: minutesFrom(outcome.retryAfterSeconds) });
          return;
        default:
          setProblem({ kind: 'core', key: 'signIn.unavailable' });
      }
    } finally {
      setBusy(false);
    }
  };

  const message = !problem
    ? null
    : problem.kind === 'wait'
      ? core('signIn.rateLimited', { minutes: problem.minutes })
      : problem.kind === 'attempts'
        ? problem.left === null
          ? t('errors.wrongCode')
          : t('errors.wrongCodeAttempts', { count: problem.left })
        : problem.kind === 'core'
          ? core(problem.key)
          : t(problem.key);

  const asking = !token || !challengeId;
  return (
    <Screen testID="exhibitor-sign-in">
      <Heading>{t('title')}</Heading>
      {asking ? (
        <>
          <Body muted>{t('intro')}</Body>
          <TextField
            autoComplete="off"
            error={fieldError?.field === 'invite' ? t(fieldError.key) : null}
            keyboardType="url"
            label={t('inviteLabel')}
            onChangeText={setInvite}
            placeholder={t('invitePlaceholder')}
            testID="exhibitor-invite"
            value={invite}
          />
          <Button busy={busy} label={t('sendCode')} onPress={submitInvite} testID="exhibitor-send" />
        </>
      ) : (
        <>
          <Body muted>{t('codeIntro')}</Body>
          <TextField
            autoComplete="one-time-code"
            error={fieldError?.field === 'code' ? t(fieldError.key) : null}
            keyboardType="number-pad"
            label={t('codeLabel')}
            maxLength={7}
            onChangeText={setCode}
            testID="exhibitor-code"
            textContentType="oneTimeCode"
            value={code}
          />
          <Button
            busy={busy}
            label={t('verify')}
            onPress={() => void submitCode()}
            testID="exhibitor-verify"
          />
          <Button
            disabled={busy}
            label={t('resend')}
            onPress={() => token && void requestCode(token)}
            testID="exhibitor-resend"
            variant="secondary"
          />
        </>
      )}
      {message ? (
        <Notice tone="danger" testID="exhibitor-error">
          {message}
        </Notice>
      ) : null}
      <Button label={t('back')} onPress={() => router.back()} testID="exhibitor-back" variant="link" />
    </Screen>
  );
}
