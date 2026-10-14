import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { IntlProvider } from 'use-intl';
import { catalogs, deviceLocale } from '../i18n';
import { useColors } from '../theme';

export default function RootLayout() {
  const colors = useColors();
  const locale = useMemo(deviceLocale, []);
  return (
    <IntlProvider locale={locale} messages={catalogs[locale]}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </IntlProvider>
  );
}
