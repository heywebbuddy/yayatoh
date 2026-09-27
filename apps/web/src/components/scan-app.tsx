'use client';

import { Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanClient, type ScanConfig, type ScanOutcome, type ServerResult } from '@/scan/client.ts';

type Phase = 'boot' | 'setup' | 'ready' | 'wiped';

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
  outside_window: 'outside_window',
};

const TONE: Record<string, string> = {
  admitted: 'border-green-600 bg-green-50 text-green-900',
  provisional: 'border-accent-700 bg-accent-50 text-accent-text',
  duplicate: 'border-accent-700 bg-accent-50 text-accent-text',
  not_today: 'border-accent-700 bg-accent-50 text-accent-text',
  outside_window: 'border-accent-700 bg-accent-50 text-accent-text',
};
const tone = (key: string) => TONE[key] ?? 'border-pink-700 bg-pink-50 text-pink-700';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * The Scan PWA: works offline from a downloaded guest list, queues scans, and syncs when the
 * network is back. Setup comes from the enrollment link (`#e=<event>&k=<key>`); the fragment
 * never reaches a server log.
 */
export function ScanApp() {
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
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async (c: ScanClient) => {
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
        setLast((prev) =>
          prev && results.has(prev.scanId)
            ? { ...prev, server: results.get(prev.scanId) as ServerResult }
            : prev,
        );
        setError(null);
        setOnline(true);
      } catch {
        setOnline(false);
      }
      await refresh(c);
    },
    [refresh],
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

  // Heartbeat + sync every 30 s; flush as soon as the network is back.
  useEffect(() => {
    if (!client || phase !== 'ready') return;
    const tick = async () => {
      try {
        const battery =
          'getBattery' in navigator
            ? await (navigator as unknown as { getBattery(): Promise<{ level: number }> }).getBattery()
            : null;
        if (await client.heartbeat(battery ? Math.round(battery.level * 100) : null)) {
          setPhase('wiped');
          return;
        }
      } catch {
        setOnline(false);
      }
      await syncNow(client);
    };
    const id = window.setInterval(tick, 30_000);
    const onOnline = () => void syncNow(client);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [client, phase, syncNow]);

  const scan = useCallback(
    async (code: string) => {
      if (!client || !code.trim()) return;
      const outcome = await client.scan(code);
      setLast(outcome);
      await refresh(client);
      if (navigator.onLine) void syncNow(client);
    },
    [client, refresh, syncNow],
  );

  // Camera scanning where the browser has BarcodeDetector (zxing-wasm fallback: M1.9c).
  useEffect(() => {
    if (!camera) return;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector })
      .BarcodeDetector;
    if (!Ctor || !video.current) return;
    const detector = new Ctor({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let stop = false;
    let lastCode = '';
    void (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!video.current) return;
      video.current.srcObject = stream;
      await video.current.play();
      while (!stop && video.current) {
        const [hit] = await detector.detect(video.current).catch(() => []);
        if (hit && hit.rawValue !== lastCode) {
          lastCode = hit.rawValue;
          await scan(hit.rawValue);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    })().catch(() => setCamera(false));
    return () => {
      stop = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [camera, scan]);

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

  const shown = last ? (last.server ?? RESULT_KEY[last.verdict] ?? 'invalid') : null;
  const resultKey = shown ? (RESULT_KEY[shown] ?? 'invalid') : null;
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
      </header>
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
        {'BarcodeDetector' in globalThis ? (
          <Button type="button" variant="secondary" className="min-h-14" onClick={() => setCamera((v) => !v)}>
            {camera ? t('scan.stopCamera') : t('scan.camera')}
          </Button>
        ) : null}
      </form>
      {camera ? (
        // biome-ignore lint/a11y/useMediaCaption: a live camera preview has no audio or captions.
        <video ref={video} className="aspect-video w-full max-w-md rounded-card bg-black" playsInline muted />
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
            {last.holderName ? (
              <p className="text-body">
                {last.holderName}
                {last.typeName ? ` · ${last.typeName}` : ''}
              </p>
            ) : null}
            <p className="text-caption">{last.server ? t('scan.confirmed') : t('scan.pending')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
