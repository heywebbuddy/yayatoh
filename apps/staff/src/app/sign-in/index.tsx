import { useRouter } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Body, Button, Card, Heading, Screen } from '../../ui/kit';

/** Staff who work without a door device: an organizer's event-day view, an exhibitor's leads (M7.4a). */
export default function SignInChooser() {
  const t = useTranslations('organizer');
  const x = useTranslations('exhibitor');
  const e = useTranslations('enrol');
  const router = useRouter();
  return (
    <Screen testID="sign-in-chooser">
      <Heading>{e('signInTitle')}</Heading>
      <Card>
        <Body>{t('about')}</Body>
        <Button
          label={t('open')}
          onPress={() => router.push('/sign-in/organizer')}
          testID="sign-in-organizer"
        />
      </Card>
      <Card>
        <Body>{x('about')}</Body>
        <Button
          label={x('open')}
          onPress={() => router.push('/sign-in/exhibitor')}
          testID="sign-in-exhibitor"
          variant="secondary"
        />
      </Card>
      <Button
        label={e('backToEnrol')}
        onPress={() => router.replace('/enrol')}
        testID="sign-in-back"
        variant="link"
      />
    </Screen>
  );
}
