import { Stack as Header } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Body, Button, Card, ErrorText, Screen, Stack, SubHeading, ToggleRow } from '../../auth/ui';
import { DEFAULT_KIND_PREFERENCES, type KindPreferences } from '../../push/preferences';
import { usePush } from '../../push/provider';
import { useColors } from '../../theme';

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
      <Header.Screen
        options={{
          headerShown: true,
          title: t('title'),
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
        }}
      />
      <Screen edges={['left', 'right', 'bottom']} testID="notification-settings">
        <Stack gap={4}>
          <Card>
            <SubHeading>{t('statusTitle')}</SubHeading>
            <Body muted={false} testID="permission-status">
              {t(`status.${permission}`)}
            </Body>
            {permission !== 'loading' ? <Body>{t(`statusBody.${permission}`)}</Body> : null}
            {permission === 'undetermined' ? (
              <Button label={t('turnOn')} onPress={push.askFromSettings} testID="turn-on" />
            ) : null}
            {permission === 'granted' || permission === 'denied' ? (
              <Button
                label={t('openSystem')}
                onPress={() => void push.openSystemSettings()}
                testID="open-system-settings"
              />
            ) : null}
            <Body>{t('optional')}</Body>
          </Card>

          <Card>
            <SubHeading>{t('kindsTitle')}</SubHeading>
            <Stack gap={2}>
              <Body muted={false}>{t('kinds.service.title')}</Body>
              <Body>{t('kinds.service.body')}</Body>
            </Stack>
            {(['reminders', 'eventChanges'] as const).map((kind) =>
              preferences.supported ? (
                <ToggleRow
                  key={kind}
                  label={t(`kinds.${kind}.title`)}
                  body={t(`kinds.${kind}.body`)}
                  value={kinds[kind]}
                  onValueChange={(value) => void change({ [kind]: value })}
                  testID={`switch-${kind}`}
                />
              ) : (
                <Stack key={kind} gap={2}>
                  <Body muted={false}>{t(`kinds.${kind}.title`)}</Body>
                  <Body>{t(`kinds.${kind}.body`)}</Body>
                </Stack>
              ),
            )}
            {!preferences.supported ? <Body testID="kinds-unavailable">{t('kindsUnavailable')}</Body> : null}
            {saveFailed ? <ErrorText testID="save-failed">{t('saveFailed')}</ErrorText> : null}
          </Card>

          <Card>
            <SubHeading>{t('marketingTitle')}</SubHeading>
            <Body testID="marketing-off">{t('marketingBody')}</Body>
          </Card>
        </Stack>
      </Screen>
    </>
  );
}
