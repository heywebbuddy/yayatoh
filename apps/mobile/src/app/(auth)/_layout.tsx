import { Stack } from 'expo-router';
import { SignInFlowProvider } from '../../auth/flow';
import { RequireSignedOut } from '../../auth/session-gate';
import { useColors } from '../../theme';

/** Signed-out people only (M7.3a): a signed-in person is sent to Tickets. */
export default function AuthLayout() {
  const colors = useColors();
  return (
    <RequireSignedOut>
      <SignInFlowProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
      </SignInFlowProvider>
    </RequireSignedOut>
  );
}
