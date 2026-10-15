import { useCore } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { AppleButton } from '../../auth/apple-button';
import { useConnectivity } from '../../auth/connectivity';
import { availableMethods } from '../../auth/methods';
import { go } from '../../auth/routes';
import { Body, Button, Card, ErrorText, Heading, Screen, Stack } from '../../auth/ui';
import { useOutcomeHandler } from '../../auth/use-outcome';

/** What the app does, then the ways in. Offline on first launch it says so and offers a retry. */
export default function Welcome() {
  const t = useTranslations('welcome');
  const core = useCore();
  const router = useRouter();
  const methods = useMemo(() => availableMethods(), []);
  const { offline, checking, recheck } = useConnectivity();
  const outcome = useOutcomeHandler();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);

  const run = async (which: 'apple' | 'google') => {
    setBusy(which);
    outcome.clear();
    try {
      outcome.handle(await (which === 'apple' ? core.signIn.withApple() : core.signIn.withGoogle()));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen testID="welcome-screen">
      <Stack gap={6}>
        <Stack gap={3}>
          <Heading>{t('title')}</Heading>
          <Body>{t('tagline')}</Body>
        </Stack>
        <Card>
          <Body muted={false}>{t('pointTickets')}</Body>
          <Body muted={false}>{t('pointDiscover')}</Body>
          <Body muted={false}>{t('pointUpdates')}</Body>
        </Card>
        {offline ? (
          <Card testID="welcome-offline">
            <Stack gap={3}>
              <Heading>{t('offlineTitle')}</Heading>
              <Body>{t('offlineBody')}</Body>
              <Button
                label={t('offlineRetry')}
                onPress={() => void recheck()}
                busy={checking}
                testID="welcome-retry"
              />
            </Stack>
          </Card>
        ) : (
          <Stack gap={3}>
            <Button label={t('email')} onPress={() => go(router, '/email')} testID="welcome-email" />
            {methods.apple ? <AppleButton label={t('apple')} onPress={() => void run('apple')} /> : null}
            {methods.google ? (
              <Button
                label={t('google')}
                variant="secondary"
                onPress={() => void run('google')}
                busy={busy === 'google'}
                disabled={busy !== null}
                testID="welcome-google"
              />
            ) : null}
            <Button
              label={t('password')}
              variant="quiet"
              onPress={() => go(router, '/password')}
              testID="welcome-password"
            />
            {outcome.message ? <ErrorText testID="welcome-error">{outcome.message}</ErrorText> : null}
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
