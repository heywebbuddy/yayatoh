import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';
import { go } from './routes';
import { Button } from './ui';

/** A visible way back for screens with no header; the system back gesture still works. */
export function BackButton({ testID = 'back' }: { testID?: string }) {
  const t = useTranslations('signIn');
  const router = useRouter();
  return (
    <Button
      label={t('back')}
      variant="quiet"
      onPress={() => (router.canGoBack() ? router.back() : go(router, '/welcome'))}
      testID={testID}
    />
  );
}
