import { useColors } from '@yayatoh/mobile-core';
import { Tabs } from 'expo-router';
import { useTranslations } from 'use-intl';

/**
 * A minimal tab bar so Discover opens before the attendee shell exists (M7.3c). M7.3a owns this file:
 * its tab shell (Tickets, Discover, Account) replaces this one when the branches merge.
 */
export default function TabsLayout() {
  const t = useTranslations('discover');
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryInk,
        tabBarInactiveTintColor: colors.ink2,
        tabBarStyle: { backgroundColor: colors.surfaceSolid, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen name="discover" options={{ title: t('tabTitle') }} />
    </Tabs>
  );
}
