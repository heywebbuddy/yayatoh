'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanClient, StaffView } from '@/scan/client.ts';

type Loaded = { view: StaffView; fetchedAt: string; fresh: boolean };

const KINDS = ['device_offline', 'device_low_battery', 'device_backlog', 'capacity_near'] as const;
const COPY_KEY = {
  device_offline: 'deviceOffline',
  device_low_battery: 'lowBattery',
  device_backlog: 'backlog',
  capacity_near: 'capacityNear',
} as const;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Staff mode (M3.4a): live counts (checked in of expected, per entrance and per date), the
 * event's device board and the alerts list. Re-read whenever the realtime channel says something
 * changed (`refreshKey`) and every 30 s; offline it shows the last answer with its time.
 */
export function StaffPanel({
  client,
  refreshKey,
  live,
  online,
  publicKey,
}: {
  client: ScanClient;
  refreshKey: number;
  live: boolean;
  /** The network as the scanner sees it: going offline or back re-reads (or falls back to the cache). */
  online: boolean;
  publicKey: string | null;
}) {
  const t = useTranslations('scanStaff');
  const format = useFormatter();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);

  // Only the latest read applies: one still in flight when the network drops must not bring back
  // a "fresh" answer after the offline read fell back to the cache (batch 3d merge, e2e race).
  const latest = useRef(0);
  const load = useCallback(async () => {
    const seq = ++latest.current;
    const next = await client.staffOverview();
    if (seq !== latest.current) return;
    setData(next);
    setLoading(false);
  }, [client]);

  // refreshKey is the realtime trigger: re-read when it changes.
  useEffect(() => {
    void load();
  }, [load, refreshKey, online]);
  useEffect(() => {
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) return <p className="text-body text-zinc-600">{t('loading')}</p>;
  if (!data)
    return (
      <p className="text-body text-zinc-600" data-testid="staff-empty">
        {t('noData')}
      </p>
    );
  const { view } = data;
  const time = (iso: string) => format.dateTime(new Date(iso), { timeStyle: 'short' });
  const names = new Map(view.byEntrance.map((e) => [e.checkpointId, e.name]));

  return (
    <div className="flex flex-col gap-6">
      <p className="flex flex-wrap gap-x-3 text-caption text-zinc-600" data-testid="staff-updated">
        <span>
          {t('lastUpdated', { time: format.dateTime(new Date(data.fetchedAt), { timeStyle: 'medium' }) })}
        </span>
        <span>{data.fresh && online ? (live ? t('live') : t('refreshing')) : t('stale')}</span>
      </p>

      <section aria-labelledby="staff-counts" className="flex flex-col gap-3">
        <h2 id="staff-counts" className="text-section">
          {t('countsTitle')}
        </h2>
        <p className="text-[28px] leading-tight font-medium" data-testid="staff-checked-in">
          {t('checkedIn', { checkedIn: view.checkedIn, expected: view.expected })}
        </p>
        {view.byEntrance.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-body font-medium">{t('byEntrance')}</h3>
            <ul className="flex list-none flex-col gap-1 p-0" aria-label={t('byEntrance')}>
              {view.byEntrance.map((e) => (
                <li key={e.checkpointId} className="flex justify-between gap-4 text-body">
                  <span>{e.name}</span>
                  <span className="tabular-nums">{format.number(e.checkedIn)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {view.byDate.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-body font-medium">{t('byDate')}</h3>
            <ul className="flex list-none flex-col gap-1 p-0" aria-label={t('byDate')}>
              {view.byDate.map((d) => (
                <li key={d.day} className="flex justify-between gap-4 text-body">
                  <span>
                    {format.dateTime(new Date(`${d.day}T12:00:00Z`), {
                      dateStyle: 'medium',
                      timeZone: 'UTC',
                    })}
                  </span>
                  <span className="tabular-nums">{format.number(d.checkedIn)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="staff-alerts" className="flex flex-col gap-2">
        <h2 id="staff-alerts" className="text-section">
          {t('alertsTitle')}
        </h2>
        {view.alerts.length === 0 ? (
          <p className="text-body text-zinc-600">{t('noAlerts')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0" aria-label={t('alertsTitle')}>
            {view.alerts.map((a) => (
              <li
                key={a.key}
                data-alert={a.kind}
                className={`rounded-card border-2 px-4 py-3 text-body ${a.severity === 'critical' ? 'border-pink-700 bg-pink-50 text-pink-700' : 'border-accent-700 bg-accent-50 text-accent-text'}`}
              >
                {t(`alert.${COPY_KEY[a.kind]}`, {
                  label: a.deviceLabel ?? '',
                  percent: a.percent ?? 0,
                  count: a.count ?? 0,
                  time: time(a.since),
                })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="staff-devices" className="flex flex-col gap-2">
        <h2 id="staff-devices" className="text-section">
          {t('devicesTitle')}
        </h2>
        {view.devices.length === 0 ? (
          <p className="text-body text-zinc-600">{t('noDevices')}</p>
        ) : (
          <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0" aria-label={t('devicesTitle')}>
            {view.devices.map((d) => (
              <li key={d.id} data-device={d.label} className="flex flex-col gap-0.5 py-2">
                <span className="text-body font-medium">
                  {d.label}
                  {d.self ? ` · ${t('thisDevice')}` : ''}
                  {d.mode === 'kiosk' ? ` · ${t('kiosk')}` : ''}
                </span>
                <span className="flex flex-wrap gap-x-3 text-caption text-zinc-600">
                  <span className={d.online ? 'text-green-900' : 'text-pink-700'}>
                    {d.online ? t('online') : t('offline')}
                  </span>
                  <span>{d.lastSeenAt ? t('lastSeen', { time: time(d.lastSeenAt) }) : t('neverSeen')}</span>
                  {d.batteryPct !== null ? <span>{t('battery', { percent: d.batteryPct })}</span> : null}
                  <span>{t('backlog', { count: d.queueDepth ?? 0 })}</span>
                  <span>
                    {d.checkpointId ? (names.get(d.checkpointId) ?? t('otherCheckpoint')) : t('wholeEvent')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StaffPushControl client={client} publicKey={publicKey} />
    </div>
  );
}

type PushStatus = 'checking' | 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

/** Staff alerts on this device (web push, opt-in per device). */
function StaffPushControl({ client, publicKey }: { client: ScanClient; publicKey: string | null }) {
  const t = useTranslations('scanStaff');
  const locale = useLocale();
  const [status, setStatus] = useState<PushStatus>('checking');
  const [supervisor, setSupervisor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!pushSupported()) return setStatus('unsupported');
    if (!publicKey) return setStatus('unavailable');
    if (Notification.permission === 'denied') {
      try {
        const { state } = await navigator.permissions.query({ name: 'notifications' });
        if (state === 'denied') return setStatus('blocked');
      } catch {
        return setStatus('blocked');
      }
    }
    const s = await client.pushStatus().catch(() => null);
    setSupervisor(!!s?.supervisor);
    setStatus(s?.subscribed ? 'on' : 'off');
  }, [client, publicKey]);
  useEffect(() => {
    check().catch(() => setStatus('off'));
  }, [check]);

  /** The notification text in this device's language, with placeholders the server fills in. */
  const copy = () =>
    Object.fromEntries(
      KINDS.map((k) => [
        k,
        {
          title: t(`push.${COPY_KEY[k]}Title`),
          body: t(`push.${COPY_KEY[k]}Body`, { label: '{label}', percent: '{percent}', count: '{count}' }),
        },
      ]),
    );

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setStatus('blocked');
        setError(t('pushBlocked'));
        return;
      }
      const reg = await navigator.serviceWorker.register('/scan-sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const json = sub.toJSON();
      const code = await client.subscribePush({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        locale,
        copy: copy(),
      });
      if (code) {
        setError(t('pushFailed'));
        return;
      }
      setStatus('on');
      setMessage(t('pushOnDone'));
    } catch {
      setError(t('pushFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await client.unsubscribePush();
      const reg = await navigator.serviceWorker.getRegistration('/');
      await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => undefined);
      setStatus('off');
      setSupervisor(false);
      setMessage(t('pushOffDone'));
    } catch {
      setError(t('pushFailed'));
    } finally {
      setBusy(false);
    }
  }

  const explain =
    status === 'unsupported'
      ? t('pushUnsupported')
      : status === 'unavailable'
        ? t('pushUnavailable')
        : status === 'blocked'
          ? t('pushBlocked')
          : status === 'checking'
            ? t('loading')
            : status === 'on'
              ? supervisor
                ? t('pushOnSupervisor')
                : t('pushOn')
              : t('pushOff');
  return (
    <section aria-labelledby="staff-push" className="flex flex-col gap-2">
      <h2 id="staff-push" className="text-section">
        {t('pushTitle')}
      </h2>
      <p className="text-body text-zinc-600">{t('pushHint')}</p>
      <p className="text-body font-medium" data-testid="staff-push-status">
        {explain}
      </p>
      {status === 'off' ? (
        <Button type="button" onClick={turnOn} disabled={busy} className="self-start">
          {t('pushTurnOn')}
        </Button>
      ) : null}
      {status === 'on' ? (
        <Button type="button" variant="secondary" onClick={turnOff} disabled={busy} className="self-start">
          {t('pushTurnOff')}
        </Button>
      ) : null}
      <div role="status" aria-live="polite" className="text-body font-medium">
        {message}
      </div>
      {error ? <Alert title={error} /> : null}
    </section>
  );
}
