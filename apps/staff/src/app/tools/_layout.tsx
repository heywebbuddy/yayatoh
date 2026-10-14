import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { useColors } from '../../theme';
import { ToolsRuntime } from '../../tools/runtime';

/** The door tools (M7.4c): one stack with the tools' runtime around it and translated headers. */
export default function ToolsLayout() {
  const t = useTranslations('tools');
  const colors = useColors();
  return (
    <ToolsRuntime>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ title: t('nav.hub') }} />
        <Stack.Screen name="lookup" options={{ title: t('nav.lookup') }} />
        <Stack.Screen name="guests" options={{ title: t('nav.guests') }} />
        <Stack.Screen name="assistance" options={{ title: t('nav.assistance') }} />
        <Stack.Screen name="today" options={{ title: t('nav.today') }} />
        <Stack.Screen name="ops" options={{ title: t('nav.ops') }} />
        <Stack.Screen name="leads/index" options={{ title: t('nav.leads') }} />
        <Stack.Screen name="leads/scan" options={{ title: t('nav.scanBadge') }} />
        <Stack.Screen name="leads/[id]" options={{ title: t('nav.lead') }} />
      </Stack>
    </ToolsRuntime>
  );
}
