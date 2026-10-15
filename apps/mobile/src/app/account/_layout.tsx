import { Stack } from 'expo-router';
import { RequireSessionExceptDeleted } from '../../auth/session-gate';
import { useColors } from '../../theme';

/**
 * Screens under Account (M7.3a): language, account deletion, and the notification settings that
 * M7.3d adds. Signed-in people only, except the "account deleted" page, which is shown after the
 * session has ended. Screens set their own header title.
 */
export default function AccountLayout() {
  const colors = useColors();
  return (
    <RequireSessionExceptDeleted>
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.surfaceSolid },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      />
    </RequireSessionExceptDeleted>
  );
}
