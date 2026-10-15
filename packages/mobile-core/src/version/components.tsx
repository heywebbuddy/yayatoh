import { type ReactNode, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { useColors } from '../theme/provider';
import { px, radius, space, TOUCH_TARGET_PX, type } from '../theme/theme';
import type { VersionGate } from './gate';

export interface UpdateScreenProps {
  readonly appName: string;
  readonly minimumVersion: string | null;
  /** An https store page, or null to tell the person to open the store themselves. */
  readonly storeUrl: string | null;
  /** Opens a link; defaults to the system's. A test seam. */
  readonly openUrl?: (url: string) => Promise<unknown>;
}

/** Shown instead of the app below the minimum version (or after a 426). Nothing else is reachable. */
export function UpdateScreen({
  appName,
  minimumVersion,
  storeUrl,
  openUrl = Linking.openURL,
}: UpdateScreenProps) {
  const t = useTranslations('core.update');
  const colors = useColors();
  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.screen}
      testID="update-screen"
    >
      <View style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('requiredTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.ink2 }]}>
          {minimumVersion
            ? t('requiredBody', { app: appName, minimum: minimumVersion })
            : t('requiredBodyGeneric', { app: appName })}
        </Text>
        {storeUrl ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action', { app: appName })}
            onPress={() => void openUrl(storeUrl)}
            style={[styles.button, { backgroundColor: colors.primary }]}
            testID="update-button"
          >
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
              {t('action', { app: appName })}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.body, { color: colors.ink2 }]} testID="update-no-link">
            {t('noStoreLink', { app: appName })}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

export interface SoftUpdateBannerProps {
  readonly appName: string;
  readonly latestVersion: string;
  readonly storeUrl: string | null;
  readonly onDismiss: () => void;
  readonly openUrl?: (url: string) => Promise<unknown>;
}

/** A dismissible nudge above the app when a newer version exists. */
export function SoftUpdateBanner({
  appName,
  latestVersion,
  storeUrl,
  onDismiss,
  openUrl = Linking.openURL,
}: SoftUpdateBannerProps) {
  const t = useTranslations('core.update');
  const colors = useColors();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: colors.primarySoft, borderColor: colors.line }]}
      testID="soft-update"
    >
      <Text style={[styles.bannerTitle, { color: colors.ink }]}>{t('softTitle')}</Text>
      <Text style={[styles.body, { color: colors.ink2 }]}>
        {t('softBody', { app: appName, latest: latestVersion })}
      </Text>
      <View style={styles.row}>
        {storeUrl ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('softAction')}
            onPress={() => void openUrl(storeUrl)}
            style={[styles.smallButton, { backgroundColor: colors.primary }]}
            testID="soft-update-action"
          >
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t('softAction')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('softDismiss')}
          onPress={onDismiss}
          style={styles.smallButton}
          testID="soft-update-dismiss"
        >
          <Text style={[styles.buttonText, { color: colors.primaryInk }]}>{t('softDismiss')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export interface VersionGateViewProps {
  readonly gate: VersionGate;
  readonly appName: string;
  readonly children: ReactNode;
  readonly openUrl?: (url: string) => Promise<unknown>;
}

/** The update screen when the version is too old, else the app (with a nudge when a newer one exists). */
export function VersionGateView({ gate, appName, children, openUrl }: VersionGateViewProps) {
  const state = useSyncExternalStore(
    gate.subscribe,
    () => gate.state,
    () => gate.state,
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (state.kind === 'required')
    return (
      <UpdateScreen
        appName={appName}
        minimumVersion={state.minimum}
        storeUrl={state.storeUrl}
        openUrl={openUrl}
      />
    );
  return (
    <View style={styles.fill}>
      {state.kind === 'recommended' && dismissed !== state.latest ? (
        <SoftUpdateBanner
          appName={appName}
          latestVersion={state.latest}
          storeUrl={state.storeUrl}
          onDismiss={() => setDismissed(state.latest)}
          openUrl={openUrl}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Centred while it fits, scrolls when the text is larger than the screen.
  screen: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space[4], paddingVertical: space[4] },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    paddingHorizontal: space[6],
    paddingVertical: space[8],
    gap: space[4],
  },
  title: { fontSize: type.section.size, fontWeight: '800', textAlign: 'auto' },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * type.prose.lineHeight, textAlign: 'auto' },
  button: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.control),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  buttonText: { fontSize: type.body.size, fontWeight: '800' },
  banner: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[2],
  },
  bannerTitle: { fontSize: type.body.size, fontWeight: '800', textAlign: 'auto' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  smallButton: {
    minHeight: TOUCH_TARGET_PX,
    minWidth: TOUCH_TARGET_PX,
    borderRadius: px(radius.control),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
});
