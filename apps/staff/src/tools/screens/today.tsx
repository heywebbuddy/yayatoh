import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'use-intl';
import type { NativePushRequest, StaffAlertKind, StaffOverview } from '../api';
import { useTools } from '../deps';
import { toolKeys, useOverview } from '../queries';
import { Body, Button, Card, Columns, Empty, ErrorState, Heading, Loading, Notice, Pane, Row, Screen, Stat } from '../ui';

const ALERT_KINDS: readonly StaffAlertKind[] = ['device_offline', 'device_low_battery', 'device_backlog', 'capacity_near'];

/** Today's check-ins against expected, the device board, alerts, and the staff push toggle (M7.4c). */
export function TodayScreen() {
  const t = useTranslations('tools');
  const core = useTranslations('core');
  const format = useFormatter();
  const { device, useOffline } = useTools();
  const offline = useOffline();
  const q = useOverview();

  if (!device) return <Screen><Empty title={t('hub.none')} /></Screen>;
  if (q.isPending) return <Screen><Loading label={t('nav.today')} /></Screen>;
  if (!q.data)
    return (
      <Screen>
        <ErrorState message={t('today.loadFailed')} retryLabel={core('common.retry')} onRetry={() => q.refetch()} />
      </Screen>
    );
  const o = q.data;
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: 'numeric', minute: '2-digit', timeZone: o.timezone });
  const percent = o.expected > 0 ? Math.min(100, Math.round((o.checkedIn / o.expected) * 100)) : 0;
  const stale = q.isError || offline;

  return (
    <Screen testID="today-screen">
      <Heading>{o.eventName}</Heading>
      <Body muted>{stale ? t('today.savedOnly', { time: time(o.asOf) }) : t('today.updated', { time: time(o.asOf) })}</Body>
      <Columns>
        <Pane>
          <Card>
            <Row>
              <Stat testID="stat-checked-in" label={t('today.checkedIn')} value={format.number(o.checkedIn)} />
              <Stat testID="stat-expected" label={t('today.expected')} value={format.number(o.expected)} />
            </Row>
            <Body muted>{t('today.percent', { percent })}</Body>
          </Card>
          <Card testID="today-entrances">
            <Heading level={2}>{t('today.entrances')}</Heading>
            {o.byEntrance.map((e) => (
              <Body key={e.checkpointId}>
                {e.name}: {format.number(e.checkedIn)}
              </Body>
            ))}
          </Card>
          {o.byDate.length > 1 ? (
            <Card testID="today-days">
              <Heading level={2}>{t('today.days')}</Heading>
              {o.byDate.map((d) => (
                <Body key={d.day}>
                  {d.day}: {format.number(d.checkedIn)}
                </Body>
              ))}
            </Card>
          ) : null}
        </Pane>
        <Pane>
          <AlertsCard overview={o} />
          <Card testID="today-devices">
            <Heading level={2}>{t('today.devices')}</Heading>
            {o.devices.map((d) => (
              <Body key={d.id}>
                {d.label}
                {d.self ? ` (${t('today.thisDevice')})` : ''} · {d.online ? t('today.online') : t('today.deviceOffline')}
                {d.batteryPct !== null ? ` · ${t('today.battery', { percent: d.batteryPct })}` : ''}
                {d.queueDepth ? ` · ${t('today.queue', { count: d.queueDepth })}` : ''}
              </Body>
            ))}
          </Card>
          <PushCard />
        </Pane>
      </Columns>
    </Screen>
  );
}

function AlertsCard({ overview }: { overview: StaffOverview }) {
  const t = useTranslations('tools');
  return (
    <Card testID="today-alerts">
      <Heading level={2}>{t('today.alerts')}</Heading>
      {overview.alerts.length === 0 ? <Body muted>{t('today.noAlerts')}</Body> : null}
      {overview.alerts.map((a) => (
        <Notice key={a.key} tone={a.severity === 'critical' ? 'stop' : 'warn'}>
          {t(`today.severity.${a.severity}`)}:{' '}
          {t(`today.alert.${a.kind}`, { label: a.deviceLabel ?? t('today.unlabeled'), percent: a.percent ?? 0 })}
        </Notice>
      ))}
    </Card>
  );
}

/** Staff push alerts on this phone (M7.2e): permission, the APNs/FCM token, and the text in the phone's language. */
function PushCard() {
  const t = useTranslations('tools');
  const locale = useLocale();
  const { device, staff, push } = useTools();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: toolKeys.pushStatus(device?.deviceId ?? ''),
    queryFn: () => (staff as NonNullable<typeof staff>).pushStatus(),
    enabled: !!staff && !!device,
    meta: { persist: false },
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'denied' | 'unavailable' | 'failed' | null>(null);

  const copyOf = (kind: StaffAlertKind | 'assistance') => ({
    title: t(`push.copy.${kind}.title`),
    // The server fills the placeholders when it sends; the app only supplies its own words.
    body: t(`push.copy.${kind}.body`, { label: '{label}', percent: '{percent}' }),
  });

  async function enable() {
    if (!staff) return;
    setBusy(true);
    setProblem(null);
    try {
      let permission = await push.permission();
      if (permission !== 'granted') permission = await push.request();
      if (permission !== 'granted') return setProblem('denied');
      const token = await push.token();
      if (!token) return setProblem('unavailable');
      const body: NativePushRequest = {
        platform: token.platform,
        token: token.token,
        ...(token.appId ? { appId: token.appId } : {}),
        locale,
        copy: {
          device_offline: copyOf('device_offline'),
          device_low_battery: copyOf('device_low_battery'),
          device_backlog: copyOf('device_backlog'),
          capacity_near: copyOf('capacity_near'),
          assistance: copyOf('assistance'),
        },
      };
      await staff.registerPush(body);
      await qc.invalidateQueries({ queryKey: toolKeys.pushStatus(device?.deviceId ?? '') });
    } catch {
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!staff) return;
    setBusy(true);
    setProblem(null);
    try {
      await staff.unregisterPush();
      await qc.invalidateQueries({ queryKey: toolKeys.pushStatus(device?.deviceId ?? '') });
    } catch {
      setProblem('failed');
    } finally {
      setBusy(false);
    }
  }

  const on = status.data?.subscribed ?? false;
  return (
    <Card testID="push-card">
      <Heading level={2}>{t('push.title')}</Heading>
      <Body muted>{t('push.body')}</Body>
      {status.data ? <Body testID="push-state">{on ? t('push.on') : t('push.off')}</Body> : null}
      {problem ? <Notice tone="warn">{t(`push.${problem}`)}</Notice> : null}
      <Button
        label={on ? t('push.disable') : t('push.enable')}
        onPress={on ? disable : enable}
        busy={busy}
        disabled={!staff || status.isPending}
        variant={on ? 'secondary' : 'primary'}
        testID="push-toggle"
      />
    </Card>
  );
}
