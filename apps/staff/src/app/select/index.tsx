import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { useDevice } from '../../device';
import { Body, Button, Card, Heading, Notice, Screen } from '../../ui/kit';
import { Splash } from '../../ui/splash';

/**
 * Event and checkpoint picker (M7.4a): the enrolled event, and where this device scans. The choice
 * is kept on the device and reported with every heartbeat; a supervisor can move the device later.
 * Also where a device is removed: that erases its token and everything the scanner stored.
 */
export default function SelectScreen() {
  const t = useTranslations('device.select');
  const core = useTranslations('core');
  const format = useFormatter();
  const device = useDevice();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [refused, setRefused] = useState(false);

  if (!device.loaded) return <Splash />;
  if (device.status !== 'enrolled') return <Redirect href="/enrol" />;

  const { event, checkpoints, checkpointId, checkpointChosen } = device;
  const when = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short', timeZone: event?.timezone });
  };

  const choose = async (id: string | null) => {
    setBusy(true);
    setRefused(false);
    try {
      if (await device.selectCheckpoint(id)) router.replace('/scan');
      else setRefused(true);
    } finally {
      setBusy(false);
    }
  };

  const options: { id: string | null; name: string; hint: string | null }[] = [
    { id: null, name: t('wholeEvent'), hint: t('wholeEventHint') },
    ...checkpoints.map((c) => ({ id: c.id, name: c.name, hint: null })),
  ];

  return (
    <Screen testID="select-screen">
      <Heading>{t('title')}</Heading>
      <Card testID="select-event">
        <Body>{event?.name ?? t('unnamedEvent')}</Body>
        {event ? (
          <Body muted testID="select-dates">
            {t('dates', { start: when(event.startsAt), end: when(event.endsAt) })}
          </Body>
        ) : null}
      </Card>

      {!event ? (
        <>
          <Notice tone="warning" testID="select-unavailable">
            {t('unavailable')}
          </Notice>
          <Button
            busy={refreshing}
            label={core('common.retry')}
            onPress={() => {
              setRefreshing(true);
              void device.refreshEvent().finally(() => setRefreshing(false));
            }}
            testID="select-retry"
            variant="secondary"
          />
        </>
      ) : null}

      <Body muted>{t('prompt')}</Body>
      {options.map((o) => {
        const selected = checkpointChosen && checkpointId === o.id;
        return (
          <Button
            busy={busy && !selected}
            hint={o.hint ?? undefined}
            key={o.id ?? 'event'}
            label={selected ? t('selectedOption', { name: o.name }) : o.name}
            onPress={() => void choose(o.id)}
            selected={selected}
            testID={o.id ? `select-checkpoint-${o.id}` : 'select-whole-event'}
            variant="secondary"
          />
        );
      })}
      {refused ? (
        <Notice tone="danger" testID="select-refused">
          {t('refused')}
        </Notice>
      ) : null}

      {checkpointChosen ? (
        <Button label={t('continue')} onPress={() => router.replace('/scan')} testID="select-continue" />
      ) : null}

      {confirmRemove ? (
        <Card testID="select-remove-confirm">
          <Heading>{t('removeTitle')}</Heading>
          <Body>{t('removeBody')}</Body>
          <Button
            label={t('removeConfirm')}
            onPress={() => {
              void device.forget().then(() => router.replace('/enrol'));
            }}
            testID="select-remove-yes"
            variant="danger"
          />
          <Button
            label={core('common.cancel')}
            onPress={() => setConfirmRemove(false)}
            testID="select-remove-no"
            variant="secondary"
          />
        </Card>
      ) : (
        <Button
          label={t('remove')}
          onPress={() => setConfirmRemove(true)}
          testID="select-remove"
          variant="link"
        />
      )}
    </Screen>
  );
}
