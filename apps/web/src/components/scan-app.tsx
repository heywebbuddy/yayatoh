'use client';

import { Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KioskScreen } from '@/components/scan-kiosk.tsx';
import { StaffPanel } from '@/components/scan-staff.tsx';
import { SupervisorPanel } from '@/components/scan-supervisor.tsx';
import { SignalBanner } from '@/components/signal-banner.tsx';
import { canUseCamera } from '@/scan/camera.ts';
import {
  ScanClient,
  type ScanConfig,
  type ScanOutcome,
  ScanSyncError,
  type StaffView,
} from '@/scan/client.ts';
import { markScanFeedback, markScanStart } from '@/scan/feedback.ts';
import { followChannel } from '@/scan/stream.ts';
import { useCameraScan } from '@/scan/use-camera.ts';

type Phase = 'boot' | 'setup' | 'ready' | 'wiped';
type View = 'scan' | 'staff' | 'supervisor';

/** Local verdicts and server results share the door screen's `checkin.result.*` messages. */
const RESULT_KEY: Record<string, string> = {
  admit: 'admitted',
  admitted: 'admitted',
  provisional: 'provisional',
  duplicate: 'duplicate',
  duplicate_offline: 'duplicate_offline',
  superseded: 'superseded',
  invalid: 'invalid',
  void: 'void',
  wrong_event: 'wrong_event',
  not_today: 'not_today',
  wrong_date: 'wrong_date',
  outside_window: 'outside_window',
  granted: 'granted',
  no_access: 'no_access',
  wrong_checkpoint: 'wrong_checkpoint',
};

const TONE: Record<string, string> = {
  admitted: 'border-green-600 bg-green-50 text-green-900',
  granted: 'border-green-600 bg-green-50 text-green-900',
  provisional: 'border-accent-700 bg-accent-50 text-accent-text',
  duplicate: 'border-accent-700 bg-accent-50 text-accent-text',
  not_today: 'border-accent-700 bg-accent-50 text-accent-text',
  wrong_date: 'border-accent-700 bg-accent-50 text-accent-text',
  outside_window: 'border-accent-700 bg-accent-50 text-accent-text',
};
const tone = (key: string) => TONE[key] ?? 'border-pink-700 bg-pink-50 text-pink-700';

/**
 * The Scan PWA: works offline from a downloaded guest list, queues scans, and syncs when the
 * network is back. Setup comes from the enrollment link (`#e=<event>&k=<key>`); the fragment
 * never reaches a server log.
 */
export function ScanApp({ publicKey = null }: { publicKey?: string | null }) {
  const t = useTranslations();
  const [phase, setPhase] = useState<Phase>('boot');
  const [client, setClient] = useState<ScanClient | null>(null);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState(0);
  const [tickets, setTickets] = useState(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [last, setLast] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [checkpointId, setCheckpointId] = useState('');
  const [hasCamera, setHasCamera] = useState(false);
  useEffect(() => setHasCamera(canUseCamera()), []);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState<View>('scan');
  const [kiosk, setKiosk] = useState(false);
  /** Bumped when the realtime channels say something changed: staff screens re-read. */
  const [refreshKey, setRefreshKey] = useState(0);
  const [live, setLive] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [channels, setChannels] = useState<StaffView['channels'] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const markRef = useRef<{ id: string; scanId: string } | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async (c: ScanClient) => {
    setCheckpointId(c.checkpoint?.id ?? '');
    setTickets(c.ticketCount);
    setLastSync(c.lastSyncAt);
    setQueue(await c.queueDepth());
  }, []);

  /** Pull the list and push the queue; any failure just means we stay offline for now. */
  const syncNow = useCallback(
    async (c: ScanClient) => {
      try {
        await c.sync();
        const results = await c.flush();
        setLast((prev) => {
          const r = prev ? results.get(prev.scanId) : undefined;
          return prev && r ? { ...prev, server: r.result, openSignals: r.openSignals } : prev;
        });
        setError(null);
        setOnline(true);
      } catch (err) {
        if (err instanceof ScanSyncError) {
          setOnline(true);
          setError(t(err.reason === 'not_assigned' ? 'scan.notAssigned' : 'scan.badScope'));
        } else setOnline(false);
      }
      await refresh(c);
    },
    [refresh, t],
  );

  const start = useCallback(
    async (config: ScanConfig) => {
      await ScanClient.save(config);
      const c = new ScanClient(config);
      if (!(await c.load())) {
        setPhase('wiped');
        return;
      }
      setClient(c);
      await syncNow(c);
      setPhase(c.lastSyncAt ? 'ready' : 'setup');
      if (!c.lastSyncAt) setError(t('scan.firstSyncFailed'));
    },
    [syncNow, t],
  );

  // Boot: the enrollment link's fragment, else the stored config.
  useEffect(() => {
    void (async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const eventId = hash.get('e');
      const token = hash.get('k');
      if (eventId && token) {
        history.replaceState(null, '', window.location.pathname);
        await start({ eventId, token });
        return;
      }
      const stored = await ScanClient.stored();
      if (stored) await start(stored);
      else setPhase('setup');
    })();
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/scan-sw.js').catch(() => undefined);
  }, [start]);

  /** Heartbeat (and the directives it brings back), then sync. */
  const tick = useCallback(async () => {
    if (!client) return;
    try {
      const battery =
        'getBattery' in navigator
          ? await (navigator as unknown as { getBattery(): Promise<{ level: number }> }).getBattery()
          : null;
      const hb = await client.heartbeat(battery ? Math.round(battery.level * 100) : null);
      if (hb.wiped) {
        setPhase('wiped');
        return;
      }
      if (hb.kioskChanged) setKiosk(client.kiosk !== null);
      if (hb.movedTo !== undefined)
        setNotice(
          t('scanStaff.movedNotice', {
            place: client.checkpoints.find((c) => c.id === hb.movedTo)?.name ?? t('checkpoints.wholeEvent'),
          }),
        );
      if (hb.synced) setNotice(t('scanStaff.syncedNotice'));
    } catch {
      setOnline(false);
    }
    await syncNow(client);
  }, [client, syncNow, t]);

  // Heartbeat + sync now and every 30 s; flush as soon as the network is back.
  useEffect(() => {
    if (!client || phase !== 'ready') return;
    setKiosk(client.kiosk !== null);
    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    // Back online: heartbeat (pending reports such as a kiosk exit) and sync.
    const onOnline = () => void tick();
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [client, phase, syncNow, tick]);

  // Learn this event's realtime channels (and this device's id) from the staff screen's data.
  useEffect(() => {
    if (!client || phase !== 'ready' || channels) return;
    void client.staffOverview().then((r) => {
      if (!r) return;
      setChannels(r.view.channels);
      setSelfId(r.view.deviceId);
    });
  }, [client, phase, channels]);

  // Live: check-ins and the device board re-read the staff screens; a supervisor's poke for this
  // device makes it heartbeat at once (sync now, new entrance, kiosk on/off).
  useEffect(() => {
    if (!client || !channels) return;
    const bump = () => setRefreshKey((k) => k + 1);
    const stops = [
      followChannel({
        channel: channels.checkins,
        token: client.token,
        onMessage: bump,
        onStatus: (st) => setLive(st === 'live'),
      }),
      followChannel({
        channel: channels.devices,
        token: client.token,
        onMessage: (event, data) => {
          const d = data as { deviceId?: string; state?: string } | null;
          // A supervisor's poke, or this device revoked: heartbeat now (a revoked key wipes).
          if (d?.deviceId === selfId && (event === 'command' || d?.state === 'revoked')) void tick();
          bump();
        },
      }),
      // M3.3b: help requests raised, taken or closed re-read the staff screen's queue.
      ...(channels.assistance
        ? [followChannel({ channel: channels.assistance, token: client.token, onMessage: bump })]
        : []),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [client, channels, selfId, tick]);

  const scan = useCallback(
    async (code: string) => {
      if (!client || !code.trim()) return;
      const mark = `scan-${++seq.current}`;
      markScanStart(mark);
      const outcome = await client.scan(code);
      markRef.current = { id: mark, scanId: outcome.scanId };
      setLast(outcome);
      await refresh(client);
      if (navigator.onLine) void syncNow(client);
    },
    [client, refresh, syncNow],
  );

  // Feedback is on screen once React has painted the verdict (M3.4a: within 300 ms).
  useEffect(() => {
    const m = markRef.current;
    if (!last || !m || m.scanId !== last.scanId) return;
    markRef.current = null;
    const raf = requestAnimationFrame(() => markScanFeedback(m.id));
    return () => cancelAnimationFrame(raf);
  }, [last]);

  // Camera scanning: BarcodeDetector, or the zxing-wasm fallback (iOS Safari).
  const onCameraError = useCallback(() => {
    setCamera(false);
    setError(t('scan.cameraFailed'));
  }, [t]);
  useCameraScan(camera, video, scan, onCameraError);

  if (phase === 'boot') return <p className="text-body text-zinc-500">{t('common.loading')}</p>;

  if (phase === 'wiped') {
    return (
      <section className="flex flex-col gap-2" aria-labelledby="wiped-heading">
        <h1 id="wiped-heading" className="text-title">
          {t('scan.wipedTitle')}
        </h1>
        <p className="text-body text-zinc-600">{t('scan.wipedDescription')}</p>
      </section>
    );
  }

  if (phase === 'setup') {
    return (
      <form
        className="flex max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void start({
            eventId: String(f.get('eventId') ?? '').trim(),
            token: String(f.get('token') ?? '').trim(),
          });
        }}
      >
        <h1 className="text-title">{t('scan.setupTitle')}</h1>
        <p className="text-body text-zinc-600">{t('scan.setupHint')}</p>
        <Input name="eventId" required label={t('scan.eventId')} autoComplete="off" />
        <Input name="token" required label={t('scan.deviceKey')} autoComplete="off" spellCheck={false} />
        {error ? <p className="text-body text-pink-700">{error}</p> : null}
        <Button type="submit" className="self-start">
          {t('scan.start')}
        </Button>
      </form>
    );
  }

  if (client && kiosk && client.kiosk)
    return (
      <KioskScreen
        client={client}
        hasCamera={hasCamera}
        afterScan={() => {
          void refresh(client);
          if (navigator.onLine) void syncNow(client);
        }}
        onExit={() => {
          void client.leaveKiosk().then(() => setKiosk(false));
        }}
      />
    );

  const shown = last ? (last.server ?? RESULT_KEY[last.verdict] ?? 'invalid') : null;
  const resultKey = shown ? (RESULT_KEY[shown] ?? 'invalid') : null;
  const views: { key: View; label: string }[] = [
    { key: 'scan', label: t('scanStaff.viewScan') },
    { key: 'staff', label: t('scanStaff.viewStaff') },
    { key: 'supervisor', label: t('scanStaff.viewSupervisor') },
  ];
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">{client?.eventName ?? t('scan.title')}</h1>
        <p className="flex flex-wrap gap-x-3 text-caption text-zinc-600" aria-live="polite">
          <span data-testid="scan-network">{online ? t('scan.online') : t('scan.offline')}</span>
          <span>{t('scan.tickets', { count: tickets })}</span>
          <span data-testid="scan-queue">{t('scan.queued', { count: queue })}</span>
          {lastSync ? <span>{t('scan.lastSync', { time: lastSync.toLocaleTimeString() })}</span> : null}
        </p>
        {notice ? (
          <p role="status" className="text-body font-medium" data-testid="scan-notice">
            {notice}
          </p>
        ) : null}
      </header>
      <nav aria-label={t('scanStaff.modes')} className="flex flex-wrap gap-2">
        {views.map((v) => (
          <Button
            key={v.key}
            type="button"
            variant={view === v.key ? 'primary' : 'secondary'}
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </Button>
        ))}
      </nav>
      {client && view === 'staff' ? (
        <StaffPanel
          client={client}
          refreshKey={refreshKey}
          live={live && online}
          online={online}
          publicKey={publicKey}
        />
      ) : null}
      {client && view === 'supervisor' ? (
        <SupervisorPanel client={client} refreshKey={refreshKey} selfId={selfId} />
      ) : null}
      {view === 'scan' ? (
        <ScanView>
          {client && (client.checkpoints.length > 0 || client.scoped) ? (
            <div className="flex flex-col gap-1.5 self-start">
              <label htmlFor="scan-app-checkpoint" className="text-caption text-zinc-600">
                {t('checkpoints.scanningAt')}
              </label>
              <select
                id="scan-app-checkpoint"
                value={checkpointId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCheckpointId(id);
                  // Tell the device board at once (the next heartbeat would take up to 30 s).
                  void client.setCheckpoint(id || null).then(() => tick());
                  input.current?.focus();
                }}
                className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
              >
                <option value="">
                  {client.scoped ? t('checkpoints.chooseStand') : t('checkpoints.wholeEvent')}
                </option>
                {client.checkpoints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = input.current?.value ?? '';
              if (input.current) input.current.value = '';
              void scan(value);
              input.current?.focus();
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="scan-app-code" className="text-caption text-zinc-600">
                {t('checkin.codeLabel')}
              </label>
              <input
                ref={input}
                id="scan-app-code"
                required
                // biome-ignore lint/a11y/noAutofocus: the scanner screen exists to receive scans.
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="min-h-14 w-full rounded-pill border border-zinc-300 bg-white px-5 font-mono text-[18px] tracking-[0.08em]"
              />
            </div>
            <Button type="submit" className="min-h-14">
              {t('checkin.check')}
            </Button>
            {hasCamera ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-14"
                onClick={() => setCamera((v) => !v)}
              >
                {camera ? t('scan.stopCamera') : t('scan.camera')}
              </Button>
            ) : null}
          </form>
          {error ? <p className="text-body text-pink-700">{error}</p> : null}
          {camera ? (
            <video
              ref={video}
              className="aspect-video w-full max-w-md rounded-card bg-black"
              playsInline
              muted
            />
          ) : null}
          <div role="status" aria-live="polite" aria-atomic="true">
            {last && resultKey ? (
              <div
                data-result={resultKey}
                className={`flex flex-col gap-1 rounded-panel border-2 px-6 py-5 ${tone(resultKey)}`}
              >
                <p className="text-[28px] leading-tight font-medium tracking-[-0.02em]">
                  {t(`checkin.result.${resultKey}`)}
                </p>
                {resultKey === 'wrong_checkpoint' && client ? (
                  <p className="text-body">
                    {client.checkpoints.length > 0
                      ? t('checkin.wrongCheckpointHint', {
                          places: client.checkpoints.map((c) => c.name).join(', '),
                        })
                      : t('checkin.noCheckpointsHint')}
                  </p>
                ) : null}
                {last.holderName ? (
                  <p className="text-body">
                    {last.holderName}
                    {last.typeName ? ` · ${last.typeName}` : ''}
                  </p>
                ) : null}
                <p className="text-caption">{last.server ? t('scan.confirmed') : t('scan.pending')}</p>
                <SignalBanner count={last.openSignals ?? 0} />
              </div>
            ) : null}
          </div>
        </ScanView>
      ) : null}
    </div>
  );
}

/** The scanner itself (the default view). */
function ScanView({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}
