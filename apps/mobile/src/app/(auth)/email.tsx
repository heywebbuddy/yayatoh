import { useCore } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { BackButton } from '../../auth/back-button';
import { useSignInFlow } from '../../auth/flow';
import { useOutcomeText } from '../../auth/outcomes';
import { go } from '../../auth/routes';
import { Body, Button, ErrorText, Field, Heading, Screen, Stack } from '../../auth/ui';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Step 1 of the email code: the address. The first sign-in with a code creates the account. */
export default function EmailScreen() {
  const t = useTranslations('signIn');
  const core = useCore();
  const router = useRouter();
  const flow = useSignInFlow();
  const text = useOutcomeText();
  const [email, setEmail] = useState(flow.email);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = email.trim();
    setProblem(null);
    if (!value) return setError(t('email.required'));
    if (!EMAIL_SHAPE.test(value)) return setError(t('email.invalid'));
    setError(null);
    setBusy(true);
    try {
      const outcome = await core.signIn.requestEmailCode(value);
      if (outcome.kind === 'sent') {
        flow.setEmail(value);
        go(router, '/code');
      } else {
        setProblem(text(outcome));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="email-screen">
      <Stack gap={6}>
        <BackButton />
        <Stack gap={3}>
          <Heading>{t('email.title')}</Heading>
          <Body>{t('email.body')}</Body>
        </Stack>
        <Field
          label={t('email.label')}
          testID="email-input"
          value={email}
          onChangeText={setEmail}
          error={error}
          placeholder={t('email.placeholder')}
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          autoFocus
        />
        {problem ? <ErrorText testID="email-problem">{problem}</ErrorText> : null}
        <Button label={t('email.submit')} onPress={() => void submit()} busy={busy} testID="email-submit" />
      </Stack>
    </Screen>
  );
}
