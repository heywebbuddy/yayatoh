import { useFormatter, useTranslations } from 'use-intl';
import type { OpsView } from '../api';
import { useTools } from '../deps';
import { useOps } from '../queries';
import { Body, Card, Columns, Empty, ErrorState, Heading, Loading, Notice, Pane, Row, Screen, Stat } from '../ui';

const KNOWN_RULES = new Set([
  'devicesOffline',
  'devicesLowBattery',
  'devicesBacklog',
  'capacityNear',
  'capacityFull',
  'assistanceOverdue',
  'printersKiosksOffline',
  'paymentsFailed',
  'paymentsStuck',
  'refundSurge',
  'sellOut',
  'readiness',
]);

/**
 * The organizer's read-only event-day view (M7.4c, `GET …/events/{event}/ops`): check-ins against
 * expected, throughput, scan issues, devices and alerts, refreshing while the screen is open. The
 * numbers are the API's, shown as returned; a section the role or plan excludes is a plain note.
 */
export function OpsScreen() {
  const t = useTranslations('ops');
  const core = useTranslations('core');
  const format = useFormatter();
  const { organizer, useOffline } = useTools();
  const offline = useOffline();
  const q = useOps();

  if (!organizer) return <Screen><Empty title={t('notSignedIn')} /></Screen>;
  if (q.isPending) return <Screen><Loading label={t('title')} /></Screen>;
  if (!q.data)
    return (
      <Screen>
        <ErrorState message={t('loadFailed')} retryLabel={core('common.retry')} onRetry={() => q.refetch()} />
      </Screen>
    );
  const v = q.data;
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: v.timeZone });
  const stale = q.isError || offline;

  return (
    <Screen testID="ops-screen">
      <Row>
        <Heading>{t('title')}</Heading>
        <Notice tone="info" testID="ops-mode">{t(`mode.${v.mode}`)}</Notice>
      </Row>
      <Body muted>{stale ? t('savedOnly', { time: time(v.asOf) }) : t('updated', { time: time(v.asOf) })}</Body>
      <Body muted>{t('readOnly')}</Body>
      <Columns>
        <Pane>
          <Checkins v={v} />
          <Throughput v={v} />
        </Pane>
        <Pane>
          <Issues v={v} />
          <Devices v={v} />
          <Alerts v={v} />
        </Pane>
      </Columns>
    </Screen>
  );
}

function Hidden() {
  const t = useTranslations('ops');
  return <Body muted>{t('hidden')}</Body>;
}

function Checkins({ v }: { v: OpsView }) {
  const t = useTranslations('ops');
  const format = useFormatter();
  const c = v.checkins;
  return (
    <Card testID="ops-checkins">
      <Heading level={2}>{t('checkins.title')}</Heading>
      {!c ? (
        <Hidden />
      ) : (
        <>
          <Row>
            <Stat testID="ops-checked-in" label={t('checkins.checkedIn')} value={format.number(c.checkedIn)} />
            <Stat testID="ops-expected" label={t('checkins.expected')} value={format.number(c.expected)} />
          </Row>
          <Body>{t('checkins.of', { checkedIn: format.number(c.checkedIn), expected: format.number(c.expected) })}</Body>
          <Body muted>{t('checkins.remaining', { count: Math.max(0, c.expected - c.checkedIn) })}</Body>
          <Heading level={2}>{t('checkins.entrances')}</Heading>
          {c.byEntrance.map((e) => (
            <Body key={e.name}>
              {e.name}: {format.number(e.checkedIn)}
            </Body>
          ))}
          {c.byDate.length > 1 ? (
            <>
              <Heading level={2}>{t('checkins.days')}</Heading>
              {c.byDate.map((d) => (
                <Body key={d.day}>
                  {d.day}: {format.number(d.checkedIn)}
                </Body>
              ))}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

function Throughput({ v }: { v: OpsView }) {
  const t = useTranslations('ops');
  const format = useFormatter();
  const th = v.throughput;
  const one = (n: number) => format.number(n, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return (
    <Card testID="ops-throughput">
      <Heading level={2}>{t('throughput.title')}</Heading>
      {!th ? (
        <Hidden />
      ) : (
        <>
          <Body>{t('throughput.rate', { rate: one(th.scansPerMin) })}</Body>
          {th.medianGapS !== null ? <Body muted>{t('throughput.gap', { seconds: one(th.medianGapS) })}</Body> : null}
          {th.queueMin !== null ? <Body muted>{t('throughput.queue', { minutes: th.queueMin })}</Body> : null}
          <Body muted>{t('throughput.recent')}: {th.series.map((p) => p.count).join(' · ')}</Body>
          <Heading level={2}>{t('throughput.entrances')}</Heading>
          {th.entrances.map((e) => (
            <Body key={e.id ?? e.name}>
              {e.name}: {one(e.scansPerMin)}
            </Body>
          ))}
        </>
      )}
    </Card>
  );
}

function Issues({ v }: { v: OpsView }) {
  const t = useTranslations('ops');
  const format = useFormatter();
  const s = v.scanIssues;
  return (
    <Card testID="ops-issues">
      <Heading level={2}>{t('issues.title')}</Heading>
      {!s ? (
        <Hidden />
      ) : s.duplicates + s.refused === 0 ? (
        <Body muted>{t('issues.none')}</Body>
      ) : (
        <Row>
          <Stat testID="ops-duplicates" label={t('issues.duplicates')} value={format.number(s.duplicates)} />
          <Stat testID="ops-refused" label={t('issues.refused')} value={format.number(s.refused)} />
        </Row>
      )}
    </Card>
  );
}

function Devices({ v }: { v: OpsView }) {
  const t = useTranslations('ops');
  const d = v.devices;
  return (
    <Card testID="ops-devices">
      <Heading level={2}>{t('devices.title')}</Heading>
      {!d ? (
        <Hidden />
      ) : d.devices.length === 0 ? (
        <Body muted>{t('devices.none')}</Body>
      ) : (
        d.devices.map((x) => (
          <Body key={x.id}>
            {x.label} · {x.online ? t('devices.online') : t('devices.offline')}
            {x.batteryPct !== null ? ` · ${t('devices.battery', { percent: x.batteryPct })}` : ''}
            {x.queueDepth ? ` · ${t('devices.queue', { count: x.queueDepth })}` : ''}
            {x.checkpoint ? ` · ${t('devices.at', { place: x.checkpoint })}` : ''}
          </Body>
        ))
      )}
    </Card>
  );
}

function Alerts({ v }: { v: OpsView }) {
  const t = useTranslations('ops');
  const a = v.alerts;
  return (
    <Card testID="ops-alerts">
      <Heading level={2}>{t('alerts.title')}</Heading>
      {!a ? (
        <Hidden />
      ) : a.alerts.length === 0 ? (
        <Body muted>{t('alerts.none')}</Body>
      ) : (
        a.alerts.map((x) => (
          <Notice key={x.id} tone={x.severity === 'critical' ? 'stop' : x.severity === 'warning' ? 'warn' : 'info'}>
            {t(`alerts.severity.${x.severity}`)}: {t(`alerts.rule.${KNOWN_RULES.has(x.rule) ? x.rule : 'other'}`)} ·{' '}
            {t(`alerts.state.${x.state}`)} · {t('alerts.count', { count: x.count })}
          </Notice>
        ))
      )}
    </Card>
  );
}
