'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanClient, ScanOutcome } from '@/scan/client.ts';
import { markScanFeedback, markScanStart } from '@/scan/feedback.ts';
import { PIN_MAX_ATTEMPTS, pinLockedUntil, verifyPinHash } from '@/scan/kiosk-pin.ts';
import { useCameraScan } from '@/scan/use-camera.ts';

/** What a guest sees: welcome, or a friendly "please see staff" (no holder name on a kiosk). */
const OK = new Set(['admit', 'admitted', 'provisional', 'granted']);
const AGAIN = new Set(['duplicate']);

/**
 * Kiosk mode (M3.4a): self check-in locked to one event and entrance. Large targets, the code
 * field always ready for a handheld scanner, the camera on request, results that clear after a
 * few seconds, and a staff exit behind the PIN (checked on the device, so it works offline).
 */
export function KioskScreen({
  client,
  afterScan,
  onExit,
  hasCamera,
}: {
  client: ScanClient;
  afterScan: () => void;
  onExit: () => void;
  hasCamera: boolean;
}) {
  const t = useTranslations('scanKiosk');
  const [last, setLast] = useState<{ outcome: ScanOutcome; mark: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const seq = useRef(0);
  const place = client.checkpoints.find((c) => c.id === client.kiosk?.checkpointId)?.name ?? null;

  const scan = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      const mark = `kiosk-${++seq.current}`;
      markScanStart(mark);
      const outcome = await client.scan(code);
      setLast({ outcome, mark });
      afterScan();
    },
    [client, afterScan],
  );
  // Feedback is on screen once React has painted the verdict.
  useEffect(() => {
    if (!last) return;
    const raf = requestAnimationFrame(() => markScanFeedback(last.mark));
    const clear = window.setTimeout(() => setLast(null), 6_000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clear);
    };
  }, [last]);

  const onCameraError = useCallback(() => {
    setCamera(false);
    setCameraError(true);
  }, []);
  useCameraScan(camera, video, scan, onCameraError);

  const verdict = last ? (last.outcome.server ?? last.outcome.verdict) : null;
  const tone = verdict && OK.has(verdict) ? 'ok' : verdict && AGAIN.has(verdict) ? 'again' : 'help';
  return (
    <div className="flex min-h-[80dvh] flex-col gap-8" data-kiosk>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-display">{t('welcome', { event: client.eventName ?? '' })}</h1>
        {place ? <p className="text-title text-ink-2">{t('entrance', { place })}</p> : null}
      </header>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.current?.value ?? '';
          if (input.current) input.current.value = '';
          void scan(value);
          input.current?.focus();
        }}
      >
        <label htmlFor="kiosk-code" className="text-title">
          {t('instruction')}
        </label>
        <input
          ref={input}
          id="kiosk-code"
          required
          // biome-ignore lint/a11y/noAutofocus: a kiosk exists to receive scans.
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="min-h-20 w-full rounded-panel border-2 border-line-strong bg-surface px-6 text-center font-mono text-[32px] tracking-[0.08em]"
        />
        <div className="flex flex-wrap justify-center gap-4">
          <Button type="submit" className="min-h-16 min-w-48 text-title">
            {t('checkIn')}
          </Button>
          {hasCamera ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-16 min-w-48 text-title"
              onClick={() => setCamera((v) => !v)}
            >
              {camera ? t('stopCamera') : t('camera')}
            </Button>
          ) : null}
        </div>
      </form>
      {cameraError ? <p className="text-center text-body text-danger">{t('cameraFailed')}</p> : null}
      {camera ? (
        <video
          ref={video}
          className="mx-auto aspect-video w-full max-w-xl rounded-card bg-black"
          playsInline
          muted
        />
      ) : null}
      <div role="status" aria-live="assertive" aria-atomic="true">
        {last ? (
          <div
            data-kiosk-result={tone}
            className={`flex flex-col items-center gap-2 rounded-panel border-4 px-8 py-10 text-center ${
              tone === 'ok'
                ? 'border-success bg-success-soft text-success'
                : tone === 'again'
                  ? 'border-primary bg-primary-soft text-primary-ink'
                  : 'border-danger bg-danger-soft text-danger'
            }`}
          >
            <p className="text-display">{t(tone === 'ok' ? 'ok' : tone === 'again' ? 'again' : 'help')}</p>
            {tone === 'ok' && last.outcome.typeName ? (
              <p className="text-title">{last.outcome.typeName}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-auto flex justify-end">
        {pinOpen ? (
          <PinPad
            pinHash={client.kiosk?.pinHash ?? ''}
            onCancel={() => {
              setPinOpen(false);
              input.current?.focus();
            }}
            onUnlock={onExit}
          />
        ) : (
          <Button type="button" variant="secondary" onClick={() => setPinOpen(true)}>
            {t('staffExit')}
          </Button>
        )}
      </div>
    </div>
  );
}

function PinPad({
  pinHash,
  onCancel,
  onUnlock,
}: {
  pinHash: string;
  onCancel: () => void;
  onUnlock: () => void;
}) {
  const t = useTranslations('scanKiosk');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const failures = useRef(0);
  const lastFail = useRef(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <form
      className="flex w-full max-w-sm flex-col gap-3 rounded-panel border border-line bg-surface px-5 py-4"
      aria-labelledby="kiosk-pin-title"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const until = pinLockedUntil(failures.current, lastFail.current);
        if (until && Date.now() < until) {
          setError(t('pinLocked', { seconds: Math.ceil((until - Date.now()) / 1000) }));
          return;
        }
        const pin = field.current?.value ?? '';
        setBusy(true);
        const ok = await verifyPinHash(pin, pinHash);
        setBusy(false);
        if (ok) {
          onUnlock();
          return;
        }
        failures.current += 1;
        lastFail.current = Date.now();
        if (field.current) field.current.value = '';
        field.current?.focus();
        const left = PIN_MAX_ATTEMPTS - failures.current;
        setError(left > 0 ? t('pinWrong', { left }) : t('pinLocked', { seconds: 30 }));
      }}
    >
      <h2 id="kiosk-pin-title" className="text-section">
        {t('pinTitle')}
      </h2>
      <label htmlFor="kiosk-pin" className="text-[13px] font-bold text-ink">
        {t('pinLabel')}
      </label>
      <input
        ref={field}
        id="kiosk-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'kiosk-pin-error' : undefined}
        className={`min-h-12 rounded-pill border bg-surface px-4 text-title ${error ? 'field-invalid' : ''}`}
      />
      {error ? (
        <p id="kiosk-pin-error" role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t('unlock')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
