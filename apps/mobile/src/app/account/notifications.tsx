import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '@yayatoh/mobile-core';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { DEFAULT_KIND_PREFERENCES, type KindPreferences } from '../../push/preferences';
import { usePush } from '../../push/provider';

/**
 * Account → Notifications (M7.3d): what the phone allows, with a way to change it, and what the app
 * sends. Turning notifications off anywhere never limits tickets, orders or sign-in.
 */
export default function NotificationSettings() {
  const t = useTranslations('push.settings');
  const colors = useColors();
  const push = usePush();
  const { preferences } = push;

  const [kinds, setKinds] = useState<KindPreferences>(DEFAULT_KIND_PREFERENCES);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!preferences.supported) return;
    let live = true;
    void preferences.load().then(
      (loaded) => live && setKinds(loaded),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [preferences]);

  const change = useCallback(
    async (patch: Partial<KindPreferences>) => {
      const previous = kinds;
      const next = { ...kinds, ...patch };
      setKinds(next);
      setSaveFailed(false);
      try {
        await preferences.save(next);
      } catch {
        setKinds(previous);
        setSaveFailed(true);
      }
    },
    [kinds, preferences],
  );

  const permission = push.permission ?? 'loading';

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('title'),
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
        }}
      />
      <ScrollView
        style={{ backgroundColor: colors.canvas }}
        contentContainerStyle={styles.content}
        testID="notification-settings"
      >
        <View style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
            {t('statusTitle')}
          </Text>
          <Text style={[styles.strong, { color: colors.ink }]} testID="permission-status">
            {t(`status.${permission}`)}
          </Text>
          {permission !== 'loading' ? (
            <Text style={[styles.body, { color: colors.ink2 }]}>{t(`statusBody.${permission}`)}</Text>
          ) : null}
          {permission === 'undetermined' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('turnOn')}
              onPress={push.askFromSettings}
              style={[styles.button, { backgroundColor: colors.primary }]}
              testID="turn-on"
            >
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t('turnOn')}</Text>
            </Pressable>
          ) : null}
          {permission === 'granted' || permission === 'denied' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('openSystem')}
              onPress={() => void push.openSystemSettings()}
              style={[styles.button, { backgroundColor: colors.primary }]}
              testID="open-system-settings"
            >
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t('openSystem')}</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.body, { color: colors.ink2 }]}>{t('optional')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
            {t('kindsTitle')}
          </Text>
          <View style={styles.kind}>
            <Text style={[styles.strong, { color: colors.ink }]}>{t('kinds.service.title')}</Text>
            <Text style={[styles.body, { color: colors.ink2 }]}>{t('kinds.service.body')}</Text>
          </View>
          {(['reminders', 'eventChanges'] as const).map((kind) => (
            <View key={kind} style={styles.kindRow}>
              <View style={styles.kindText}>
                <Text style={[styles.strong, { color: colors.ink }]}>{t(`kinds.${kind}.title`)}</Text>
                <Text style={[styles.body, { color: colors.ink2 }]}>{t(`kinds.${kind}.body`)}</Text>
              </View>
              {preferences.supported ? (
                <Switch
                  accessibilityRole="switch"
                  accessibilityLabel={t(`kinds.${kind}.title`)}
                  value={kinds[kind]}
                  onValueChange={(value) => void change({ [kind]: value })}
                  testID={`switch-${kind}`}
                />
              ) : null}
            </View>
          ))}
          {!preferences.supported ? (
            <Text style={[styles.body, { color: colors.ink2 }]} testID="kinds-unavailable">
              {t('kindsUnavailable')}
            </Text>
          ) : null}
          {saveFailed ? (
            <Text
              accessibilityRole="alert"
              style={[styles.body, { color: colors.danger }]}
              testID="save-failed"
            >
              {t('saveFailed')}
            </Text>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
            {t('marketingTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.ink2 }]} testID="marketing-off">
            {t('marketingBody')}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[4] },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    padding: space[4],
    gap: space[3],
  },
  heading: { fontSize: 18, fontWeight: '800', textAlign: 'auto' },
  strong: { fontSize: type.prose.size, fontWeight: '700', textAlign: 'auto' },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * type.prose.lineHeight, textAlign: 'auto' },
  button: {
    minHeight: TOUCH_TARGET_PX,
    borderRadius: px(radius.card),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  buttonText: { fontSize: type.prose.size, fontWeight: '700', textAlign: 'center' },
  kind: { gap: space[1] },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  kindText: { flex: 1, gap: space[1] },
});
