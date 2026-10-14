import { LOCALE_NAMES, LOCALES, useLocaleSettings } from '@yayatoh/mobile-core';
import { Stack as Header } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Card, Heading, Row, Screen } from '../../auth/ui';

/** The in-app language override: the phone's language, or one of the 13 the app is translated into. */
export default function LanguageScreen() {
  const t = useTranslations('core.language');
  const { choice, setChoice } = useLocaleSettings();
  return (
    <Screen testID="language-screen">
      <Header.Screen options={{ title: t('label') }} />
      <Heading>{t('label')}</Heading>
      <Card>
        <Row
          role="radio"
          checked={choice === 'system'}
          label={t('system')}
          onPress={() => setChoice('system')}
          testID="language-system"
        />
        {LOCALES.map((locale) => (
          <Row
            key={locale}
            role="radio"
            checked={choice === locale}
            label={LOCALE_NAMES[locale]}
            onPress={() => setChoice(locale)}
            testID={`language-${locale}`}
          />
        ))}
      </Card>
    </Screen>
  );
}
