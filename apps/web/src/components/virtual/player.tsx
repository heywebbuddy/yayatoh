'use client';

import { Alert, Button, buttonClass, Label, PageHeader, StatusPill } from '@yayatoh/ui';
import { ArrowLeft, MonitorPlay } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackState } from '@/app/[locale]/events/[slug]/watch/[ticket]/[session]/actions.ts';
import { Link } from '@/i18n/navigation.ts';

/** Twice a minute, so every minute that plays gets a heartbeat (the server counts each once). */
const HEARTBEAT_MS = 30_000;
/** Ask for a fresh playback token when less than this is left. */
const RENEW_MS = 2 * 60_000;

type Phase = 'idle' | 'starting' | 'playing' | 'paused' | 'error';

const REASONS = new Set([
  'in_person_only',
  'stream_off',
  'views_per_hour',
  'invalid_token',
  'ticket_void',
  'video_off',
]);

/**
 * The virtual player (M6.9a), phone first. "Start watching" asks the server for a playback token
 * for this ticket and session; the stream loads with it (the fake provider shows a test pattern
 * after its CDN accepted the token; Mux plays HLS). While it plays, a heartbeat goes out every 30
 * seconds with a rising sequence number; the server counts each minute once. The token is renewed
 * before it expires; pausing stops the heartbeats.
 */
export function VirtualPlayer({
  eventName,
  sessionTitle,
  backHref,
  initialMinutes,
  heartbeatUrl,
  start,
}: {
  eventName: string;
  sessionTitle: string;
  backHref: string;
  initialMinutes: number;
  heartbeatUrl: string;
  start: () => Promise<PlaybackState>;
}) {
  const t = useTranslations('virtual.player');
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const live = useRef<PlaybackState | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const fail = useCallback(
    (code: string | null, reason?: string | null) => {
      stop();
      setPhase('error');
      setProblem(reason && REASONS.has(reason) ? reason : code === 'not_found' ? 'not_found' : 'generic');
    },
    [stop],
  );

  /** A fresh viewing: token, CDN check (fake), sequence back to zero. */
  const open = useCallback(async (): Promise<boolean> => {
    const p = await start();
    if (!p.ok || !p.token || !p.playbackUrl) {
      fail(p.code, p.reason);
      return false;
    }
    if (p.provider === 'fake') {
      const res = await fetch(p.playbackUrl, { cache: 'no-store' }).catch(() => null);
      if (!res?.ok) {
        fail('forbidden', 'invalid_token');
        return false;
      }
    }
    live.current = p;
    seq.current = 0;
    setPlayback(p);
    return true;
  }, [start, fail]);

  const beat = useCallback(async () => {
    const p = live.current;
    if (!p?.token) return;
    if (p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < RENEW_MS && !(await open())) return;
    const token = live.current?.token;
    seq.current += 1;
    const res = await fetch(heartbeatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, seq: seq.current }),
      cache: 'no-store',
    }).catch(() => null);
    if (!res) return; // offline for a moment: the next beat tries again
    const body = (await res.json().catch(() => null)) as {
      minutes?: number;
      code?: string;
      reason?: string;
    } | null;
    if (res.ok && typeof body?.minutes === 'number') setMinutes(body.minutes);
    else if (!res.ok) fail(body?.code ?? null, body?.reason ?? null);
  }, [heartbeatUrl, open, fail]);

  const play = async () => {
    setProblem(null);
    setPhase('starting');
    if (
      !live.current ||
      (live.current.expiresAt && new Date(live.current.expiresAt).getTime() - Date.now() < RENEW_MS)
    ) {
      if (!(await open())) return;
    }
    setPhase('playing');
    await beat();
    stop();
    timer.current = setInterval(() => void beat(), HEARTBEAT_MS);
  };

  const pause = () => {
    stop();
    setPhase('paused');
  };

  useEffect(() => stop, [stop]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={<Label>{eventName}</Label>}
        title={sessionTitle}
        description={t('countNote')}
        actions={
          <Link href={backHref} className={buttonClass('ghost')}>
            <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
            {t('back')}
          </Link>
        }
      />
      <section aria-labelledby="player-heading" className="flex flex-col gap-4">
        <h2 id="player-heading" className="sr-only">
          {t('heading')}
        </h2>
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-panel border border-line bg-surface-2 p-4 text-center">
          {phase === 'playing' && playback?.provider === 'mux' && playback.playbackUrl ? (
            // biome-ignore lint/a11y/useMediaCaption: live streams carry the provider's own captions track when the organizer adds one
            <video
              className="size-full rounded-tile"
              src={playback.playbackUrl}
              autoPlay
              playsInline
              controls
            />
          ) : (
            <>
              <MonitorPlay aria-hidden="true" className="size-10 text-ink-2" />
              <p className="m-0 text-body text-ink-2">
                {phase === 'playing' ? t('testPattern') : t('ready')}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {phase === 'playing' ? (
            <Button type="button" variant="secondary" onClick={pause}>
              {t('pause')}
            </Button>
          ) : (
            <Button type="button" onClick={() => void play()} disabled={phase === 'starting'}>
              {phase === 'paused' ? t('resume') : t('play')}
            </Button>
          )}
          <span data-testid="player-status">
            {phase === 'playing' ? (
              <StatusPill tone="success" live label={t('playing')} />
            ) : phase === 'paused' ? (
              <StatusPill tone="waiting" label={t('paused')} />
            ) : phase === 'starting' ? (
              <StatusPill tone="neutral" label={t('starting')} />
            ) : null}
          </span>
        </div>
        <p className="m-0 text-body text-ink" aria-live="polite" data-testid="watched-minutes">
          {t('watched', { count: minutes })}
        </p>
        <div aria-live="assertive">{problem ? <Alert title={t(`errors.${problem}`)} /> : null}</div>
      </section>
    </main>
  );
}
