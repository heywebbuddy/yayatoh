import { LOCALE_NAMES, useCore, useLocaleSettings, useSession, useTheme } from '@yayatoh/mobile-core';
import type { ThemeChoice } from '@yayatoh/ui/tokens';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { go } from '../../auth/routes';
import { Body, Button, Card, ErrorText, Heading, Row, Screen, Stack, SubHeading } from '../../auth/ui';

type Confirm = 'signOut' | 'everywhere' | null;
const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Account (M7.3a): who you are, language and appearance, notification settings, sign out, delete. */
export default function AccountTab() {
  const t = useTranslations('account');
  const tLanguage = useTranslations('core.language');
  const tTheme = useTranslations('core.theme');
  const core = useCore();
  const router = useRouter();
  const session = useSession();
  const locale = useLocaleSettings();
  const theme = useTheme();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (session.status !== 'signedIn') return null;
  const { user } = session;

  const languageName = locale.choice === 'system' ? tLanguage('system') : LOCALE_NAMES[locale.choice];

  const signOut = async () => {
    setBusy(true);
    try {
      await core.session.signOut();
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    setBusy(true);
    setProblem(null);
    try {
      // Nothing changes if the server cannot be reached, so say so instead of pretending.
      const result = await core.account.signOutEverywhere();
      if (result.kind !== 'done') setProblem(t('signOutEverywhere.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right']} testID="account-screen">
      <Stack gap={6}>
        <Heading>{t('title')}</Heading>

        <Card testID="account-profile">
          <Row label={t('profile.name')} value={user.name} testID="account-name" />
          <Row label={t('profile.email')} value={user.email} testID="account-email" />
          <Row
            label={t('profile.status')}
            value={user.emailVerified ? t('profile.verified') : t('profile.unverified')}
            testID="account-verified"
          />
        </Card>

        <Stack gap={2}>
          <SubHeading>{t('preferences')}</SubHeading>
          <Card>
            <Row
              label={tLanguage('label')}
              value={languageName}
              onPress={() => go(router, '/account/language')}
              testID="account-language"
            />
            <Stack gap={2}>
              <Body muted={false}>{tTheme('label')}</Body>
              {THEMES.map((choice) => (
                <Row
                  key={choice}
                  role="radio"
                  checked={theme.choice === choice}
                  label={tTheme(choice)}
                  onPress={() => theme.setChoice(choice)}
                  testID={`account-theme-${choice}`}
                />
              ))}
            </Stack>
            <Row
              label={t('notifications')}
              onPress={() => go(router, '/account/notifications')}
              testID="account-notifications"
            />
          </Card>
        </Stack>

        <Stack gap={3}>
          {confirm === 'signOut' ? (
            <Card testID="account-confirm-sign-out">
              <Body muted={false}>{t('signOut.confirm')}</Body>
              <Button
                label={t('signOut.action')}
                onPress={() => void signOut()}
                busy={busy}
                testID="account-sign-out-confirm"
              />
              <Button
                label={t('cancel')}
                variant="secondary"
                onPress={() => setConfirm(null)}
                disabled={busy}
                testID="account-sign-out-cancel"
              />
            </Card>
          ) : confirm === 'everywhere' ? (
            <Card testID="account-confirm-everywhere">
              <Body muted={false}>{t('signOutEverywhere.confirm')}</Body>
              {problem ? <ErrorText testID="account-everywhere-problem">{problem}</ErrorText> : null}
              <Button
                label={t('signOutEverywhere.action')}
                onPress={() => void signOutEverywhere()}
                busy={busy}
                testID="account-everywhere-confirm"
              />
              <Button
                label={t('cancel')}
                variant="secondary"
                onPress={() => {
                  setConfirm(null);
                  setProblem(null);
                }}
                disabled={busy}
                testID="account-everywhere-cancel"
              />
            </Card>
          ) : (
            <>
              <Button
                label={t('signOut.button')}
                variant="secondary"
                onPress={() => setConfirm('signOut')}
                testID="account-sign-out"
              />
              <Button
                label={t('signOutEverywhere.button')}
                variant="secondary"
                onPress={() => setConfirm('everywhere')}
                testID="account-sign-out-everywhere"
              />
            </>
          )}
        </Stack>

        <Stack gap={2}>
          <SubHeading>{t('danger.title')}</SubHeading>
          <Body>{t('danger.body')}</Body>
          <Button
            label={t('delete.entry')}
            variant="danger"
            onPress={() => go(router, '/account/delete')}
            testID="account-delete"
          />
        </Stack>

        <Body testID="account-version">{t('version', { version: core.identity.version })}</Body>
      </Stack>
    </Screen>
  );
}
