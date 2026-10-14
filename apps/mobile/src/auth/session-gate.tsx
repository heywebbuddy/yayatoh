import { useSession } from '@yayatoh/mobile-core';
import { Redirect, useSegments } from 'expo-router';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { useColors } from '../theme';
import { href, PATHS } from './routes';

/** Shown for the instant the stored session is being read: never a blank screen. */
export function SessionSplash() {
  const colors = useColors();
  const t = useTranslations('welcome');
  return (
    <View
      accessible
      accessibilityLabel={t('loading')}
      accessibilityRole="progressbar"
      style={[styles.splash, { backgroundColor: colors.canvas }]}
      testID="session-splash"
    >
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

/** Only for signed-in people: signed-out visitors go to the welcome screen. */
export function RequireSession({ children, bypass = false }: { children: ReactNode; bypass?: boolean }) {
  const session = useSession();
  // Same element either way, so a bypass never remounts the screens below.
  if (bypass) return children;
  if (session.status === 'loading') return <SessionSplash />;
  if (session.status === 'signedOut') return <Redirect href={href(PATHS.welcome)} />;
  return children;
}

interface AccountFlow {
  /** True while the account is being deleted: the session ending is expected and must not redirect. */
  readonly deleting: boolean;
  setDeleting(value: boolean): void;
}
const AccountFlowContext = createContext<AccountFlow>({ deleting: false, setDeleting: () => {} });
export const useAccountFlow = (): AccountFlow => useContext(AccountFlowContext);

/**
 * For the `account/` screens: signed-in people only. Two exceptions: the "account deleted" page,
 * which is shown after the session has ended, and the delete screen while the deletion is running
 * (it signs the person out itself and then opens that page).
 */
export function RequireSessionExceptDeleted({ children }: { children: ReactNode }) {
  const [deleting, setDeleting] = useState(false);
  const flow = useMemo(() => ({ deleting, setDeleting }), [deleting]);
  const segments = useSegments() as string[];
  return (
    <AccountFlowContext.Provider value={flow}>
      <RequireSession bypass={deleting || segments.at(-1) === 'deleted'}>{children}</RequireSession>
    </AccountFlowContext.Provider>
  );
}

/** Only for signed-out people: a signed-in person goes straight to Tickets. */
export function RequireSignedOut({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.status === 'loading') return <SessionSplash />;
  if (session.status === 'signedIn') return <Redirect href={href(PATHS.tickets)} />;
  return children;
}

const styles = StyleSheet.create({ splash: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
