import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { type Enrolment, enrolmentFrom, enrolmentFromLink, useDevice } from '../../device';
import { minutesFrom } from '../../enrol/minutes';
import { useEnrol } from '../../enrol/use-enrol';
import { Body, Button, Card, Heading, Notice, Screen, TextField } from '../../ui/kit';
import { Splash } from '../../ui/splash';

/**
 * Enrolment (M7.4a): the landing screen of a device that is not enrolled. An organizer shows the
 * enrolment QR from the console; this device scans it (the camera screen) or opens its link, which
 * arrives here as the `event` and `key` route params. The key is read once, cleared from the route,
 * proven with one call and kept only in the keychain.
 */
export default function EnrolScreen() {
  const t = useTranslations('enrol');
  const core = useTranslations('core');
  const device = useDevice();
  const router = useRouter();
  const params = useLocalSearchParams<{ event?: string; key?: string; invalid?: string }>();
  const { busy, error, retryAfterSeconds, enrol, setError } = useEnrol();
  const [link, setLink] = useState('');
  const [pending, setPending] = useState<Enrolment | null>(null);
  const handled = useRef<string | null>(null);

  const { event, key, invalid } = params;
  const { loaded, status, token } = device;
  // A link opened from outside: take it once, then remove the key from the route.
  useEffect(() => {
    if (!loaded) return;
    const marker = `${event ?? ''}|${key ?? ''}|${invalid ?? ''}`;
    if (marker === '||') {
      handled.current = null;
      return;
    }
    if (handled.current === marker) return;
    handled.current = marker;
    router.setParams({ event: undefined, key: undefined, invalid: undefined });
    const enrolment = event && key ? enrolmentFrom(event, key) : null;
    if (!enrolment) {
      setError('invalid_link');
    } else if (status === 'enrolled' && token !== enrolment.token) {
      // Enrolling again erases this device's scans and manifest: ask first.
      setPending(enrolment);
    } else {
      void enrol(enrolment);
    }
  }, [loaded, event, key, invalid, status, token, router, enrol, setError]);

  if (!loaded) return <Splash />;

  const ended = status === 'revoked' || status === 'wiped' ? status : null;
  const submitLink = () => {
    const enrolment = enrolmentFromLink(link);
    if (!enrolment) {
      setError('invalid_link');
      return;
    }
    if (status === 'enrolled' && token !== enrolment.token) setPending(enrolment);
    else void enrol(enrolment);
  };

  return (
    <Screen testID="enrol-screen">
      <Heading>{t('title')}</Heading>
      {ended ? (
        <Notice tone="warning" testID="enrol-ended">
          {t(`notices.${ended}`)}
        </Notice>
      ) : null}
      {ended ? (
        <Button
          label={core('common.ok')}
          onPress={() => void device.acknowledgeEnded()}
          testID="enrol-ended-dismiss"
          variant="secondary"
        />
      ) : null}
      <Body muted>{t('intro')}</Body>

      {pending ? (
        <Card testID="enrol-replace">
          <Heading>{t('replace.title')}</Heading>
          <Body>
            {device.event ? t('replace.body', { event: device.event.name }) : t('replace.bodyNoEvent')}
          </Body>
          <Button
            label={t('replace.confirm')}
            onPress={() => {
              const next = pending;
              setPending(null);
              void enrol(next);
            }}
            testID="enrol-replace-confirm"
            variant="danger"
          />
          <Button
            label={t('replace.cancel')}
            onPress={() => setPending(null)}
            testID="enrol-replace-cancel"
            variant="secondary"
          />
        </Card>
      ) : (
        <>
          <Button
            busy={busy}
            label={t('scan')}
            onPress={() => router.push('/enrol/scan')}
            testID="enrol-scan"
          />
          {busy ? (
            <Body muted testID="enrol-working">
              {t('working')}
            </Body>
          ) : null}
          <TextField
            autoComplete="off"
            keyboardType="url"
            label={t('linkLabel')}
            onChangeText={(v) => {
              setLink(v);
              if (error) setError(null);
            }}
            placeholder={t('linkPlaceholder')}
            testID="enrol-link"
            value={link}
          />
          <Button
            disabled={busy}
            label={t('submit')}
            onPress={submitLink}
            testID="enrol-submit"
            variant="secondary"
          />
        </>
      )}

      {error ? (
        <Notice tone="danger" testID="enrol-error">
          {error === 'rateLimited'
            ? core('signIn.rateLimited', { minutes: minutesFrom(retryAfterSeconds) })
            : t(`errors.${error}`)}
        </Notice>
      ) : null}

      <Card>
        <Body muted>{t('staffPrompt')}</Body>
        <Button
          label={t('signInOrganizer')}
          onPress={() => router.push('/sign-in/organizer')}
          testID="enrol-organizer"
          variant="link"
        />
        <Button
          label={t('signInExhibitor')}
          onPress={() => router.push('/sign-in/exhibitor')}
          testID="enrol-exhibitor"
          variant="link"
        />
      </Card>
    </Screen>
  );
}
