import { Stack as Header, useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';
import { replace } from '../../auth/routes';
import { Body, Button, Heading, Screen, Stack } from '../../auth/ui';

/** Shown once the account is gone and the phone holds nothing of it. */
export default function AccountDeleted() {
  const t = useTranslations('account.deleted');
  const router = useRouter();
  return (
    <Screen testID="account-deleted-screen">
      <Header.Screen options={{ title: t('title'), headerBackVisible: false, gestureEnabled: false }} />
      <Stack gap={6}>
        <Stack gap={3}>
          <Heading>{t('title')}</Heading>
          <Body>{t('body')}</Body>
        </Stack>
        <Button label={t('done')} onPress={() => replace(router, '/welcome')} testID="account-deleted-done" />
      </Stack>
    </Screen>
  );
}
