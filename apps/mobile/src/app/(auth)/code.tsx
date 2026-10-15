import { useCore } from '@yayatoh/mobile-core';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { BackButton } from '../../auth/back-button';
import { CodeInput } from '../../auth/code-input';
import { RESEND_AFTER_SECONDS, useCountdown } from '../../auth/countdown';
import { useSignInFlow } from '../../auth/flow';
import { useOutcomeText, waitSeconds } from '../../auth/outcomes';
import { href, PATHS, replace } from '../../auth/routes';
import { Body, Button, ErrorText, Heading, Notice, Screen, Stack } from '../../auth/ui';
import { useOutcomeHandler } from '../../auth/use-outcome';

/** Step 2 of the email code: the six digits, with resend and the server's rate limit shown. */
export default function CodeScreen() {
  const t = useTranslations('signIn');
  const core = useCore();
  const router = useRouter();
  const flow = useSignInFlow();
  const text = useOutcomeText();
  const outcome = useOutcomeHandler({ emailedCode: true });
  const cooldown = useCountdown(RESEND_AFTER_SECONDS);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [resendProblem, setResendProblem] = useState<string | null>(null);
  const inFlight = useRef(false);

  // A server rate limit on the sign-in itself also holds the resend back for that long.
  useEffect(() => {
    if (outcome.wait) cooldown.start(outcome.wait);
  }, [outcome.wait, cooldown.start]);

  if (!flow.email) return <Redirect href={href(PATHS.email)} />;

  const submit = async (value: string) => {
    if (inFlight.current) return;
    if (value.length !== 6) return setIncomplete(true);
    setIncomplete(false);
    inFlight.current = true;
    setBusy(true);
    try {
      outcome.handle(await core.signIn.withEmailCode(flow.email, value));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setResendNote(null);
    setResendProblem(null);
    try {
      const result = await core.signIn.requestEmailCode(flow.email);
      if (result.kind === 'sent') {
        setCode('');
        outcome.clear();
        setResendNote(t('code.resent'));
        cooldown.start(RESEND_AFTER_SECONDS);
      } else {
        setResendProblem(text(result));
        const wait = waitSeconds(result);
        if (wait) cooldown.start(wait);
      }
    } finally {
      setResending(false);
    }
  };

  const startOver = () => {
    flow.reset();
    replace(router, '/email');
  };

  const minutes = 10;
  const error = incomplete ? t('code.incomplete') : outcome.message;
  return (
    <Screen testID="code-screen">
      <Stack gap={6}>
        <BackButton />
        <Stack gap={3}>
          <Heading>{t('code.title')}</Heading>
          <Body>{t('code.body', { email: flow.email, minutes })}</Body>
        </Stack>
        <CodeInput
          label={t('code.label')}
          testID="code-input"
          value={code}
          onChange={(next) => {
            setCode(next);
            setIncomplete(false);
          }}
          onComplete={(value) => void submit(value)}
          error={error}
          autoFocus
        />
        <Button label={t('code.submit')} onPress={() => void submit(code)} busy={busy} testID="code-submit" />
        {outcome.startOver ? (
          <Button label={t('startAgain')} variant="secondary" onPress={startOver} testID="code-start-over" />
        ) : null}
        {resendNote ? <Notice testID="code-resent">{resendNote}</Notice> : null}
        {resendProblem ? <ErrorText testID="code-resend-problem">{resendProblem}</ErrorText> : null}
        <Button
          label={
            cooldown.remaining > 0 ? t('code.resendIn', { seconds: cooldown.remaining }) : t('code.resend')
          }
          variant="secondary"
          onPress={() => void resend()}
          disabled={cooldown.remaining > 0}
          busy={resending}
          testID="code-resend"
        />
        <Button label={t('code.change')} variant="quiet" onPress={startOver} testID="code-change-email" />
      </Stack>
    </Screen>
  );
}
