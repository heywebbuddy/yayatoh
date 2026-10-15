import { useCore } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { BackButton } from '../../auth/back-button';
import { go } from '../../auth/routes';
import { Body, Button, ErrorText, Field, Heading, Screen, Stack } from '../../auth/ui';
import { useOutcomeHandler } from '../../auth/use-outcome';

/** Password sign-in, for people who already have a password. Two-step accounts continue to the code. */
export default function PasswordScreen() {
  const t = useTranslations('signIn');
  const core = useCore();
  const router = useRouter();
  const outcome = useOutcomeHandler();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = t('email.required');
    if (!password) next.password = t('password.required');
    setErrors(next);
    outcome.clear();
    if (next.email || next.password) return;
    setBusy(true);
    try {
      outcome.handle(await core.signIn.withPassword(email, password));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="password-screen">
      <Stack gap={6}>
        <BackButton />
        <Stack gap={3}>
          <Heading>{t('password.title')}</Heading>
          <Body>{t('password.body')}</Body>
        </Stack>
        <Field
          label={t('email.label')}
          testID="password-email"
          value={email}
          onChangeText={setEmail}
          error={errors.email ?? null}
          placeholder={t('email.placeholder')}
          keyboardType="email-address"
          inputMode="email"
          textContentType="username"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label={t('password.label')}
          testID="password-input"
          value={password}
          onChangeText={setPassword}
          error={errors.password ?? null}
          secureTextEntry={!shown}
          textContentType="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <Button
          label={shown ? t('password.hide') : t('password.show')}
          variant="quiet"
          onPress={() => setShown((s) => !s)}
          testID="password-toggle"
        />
        {outcome.message ? <ErrorText testID="password-problem">{outcome.message}</ErrorText> : null}
        <Button
          label={t('password.submit')}
          onPress={() => void submit()}
          busy={busy}
          testID="password-submit"
        />
        <Button
          label={t('password.useCode')}
          variant="quiet"
          onPress={() => go(router, '/email')}
          testID="password-use-code"
        />
      </Stack>
    </Screen>
  );
}
