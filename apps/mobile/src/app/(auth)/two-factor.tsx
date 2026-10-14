import { useCore } from '@yayatoh/mobile-core';
import { Redirect, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { BackButton } from '../../auth/back-button';
import { useSignInFlow } from '../../auth/flow';
import { href, PATHS, replace } from '../../auth/routes';
import { Body, Button, Field, Heading, Screen, Stack } from '../../auth/ui';
import { useOutcomeHandler } from '../../auth/use-outcome';

/** The second step for accounts with two-step verification: an authenticator code or a backup code. */
export default function TwoFactorScreen() {
  const t = useTranslations('signIn');
  const core = useCore();
  const router = useRouter();
  const flow = useSignInFlow();
  const outcome = useOutcomeHandler();
  const [code, setCode] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = flow.pending?.step === 'twoFactor' ? flow.pending : null;

  if (!pending) return <Redirect href={href(PATHS.welcome)} />;

  const submit = async () => {
    if (inFlight.current) return;
    if (!code.trim()) return setMissing(true);
    setMissing(false);
    inFlight.current = true;
    setBusy(true);
    try {
      outcome.handle(await core.signIn.completeTwoFactor(pending.challenge, code));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const startOver = () => {
    flow.reset();
    replace(router, '/welcome');
  };

  return (
    <Screen testID="two-factor-screen">
      <Stack gap={6}>
        <BackButton />
        <Stack gap={3}>
          <Heading>{t('twoFactor.title')}</Heading>
          <Body>{t('twoFactor.body')}</Body>
        </Stack>
        <Field
          label={t('twoFactor.label')}
          testID="two-factor-input"
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setMissing(false);
          }}
          error={missing ? t('twoFactor.required') : outcome.message}
          keyboardType="default"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          autoFocus
        />
        <Button
          label={t('twoFactor.submit')}
          onPress={() => void submit()}
          busy={busy}
          testID="two-factor-submit"
        />
        {outcome.startOver ? (
          <Button
            label={t('startAgain')}
            variant="secondary"
            onPress={startOver}
            testID="two-factor-start-over"
          />
        ) : null}
      </Stack>
    </Screen>
  );
}
