import { Tabs } from 'expo-router';
import { useTranslations } from 'use-intl';
import { RequireSession } from '../../auth/session-gate';
import { TOUCH_TARGET_PX, useColors } from '../../theme';

const noIcon = () => null;

/**
 * The attendee app's tab shell (M7.3a): Tickets, Discover and Account, for signed-in people only.
 * Signed-out people are sent to the welcome flow.
 */
export default function TabsLayout() {
  const t = useTranslations('account.tabs');
  const colors = useColors();
  return (
    <RequireSession>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primaryInk,
          tabBarInactiveTintColor: colors.ink2,
          tabBarStyle: { backgroundColor: colors.surfaceSolid, borderTopColor: colors.line },
          tabBarItemStyle: { minHeight: TOUCH_TARGET_PX, justifyContent: 'center' },
          tabBarLabelStyle: { fontSize: 14, fontWeight: '700' },
          tabBarIcon: noIcon,
          tabBarIconStyle: { display: 'none' },
          sceneStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Tabs.Screen name="tickets" options={{ title: t('tickets'), tabBarLabel: t('tickets') }} />
        <Tabs.Screen name="discover" options={{ title: t('discover'), tabBarLabel: t('discover') }} />
        <Tabs.Screen name="account" options={{ title: t('account'), tabBarLabel: t('account') }} />
      </Tabs>
    </RequireSession>
  );
}
