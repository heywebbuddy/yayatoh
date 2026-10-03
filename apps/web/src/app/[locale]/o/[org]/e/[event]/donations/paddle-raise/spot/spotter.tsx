'use client';

import type { EntryOutcome, SpotterStateDto } from '@yayatoh/donations';
import {
  emptyQueue,
  enqueue,
  nextBatch,
  restoreQueue,
  type SettledEntry,
  type SpotterQueue,
  settle,
} from '@yayatoh/donations/paddle-queue';
import { parsePaddleNumber } from '@yayatoh/donations/paddles';
import { formatMoney, money } from '@yayatoh/kernel';
import { Button, Card, cx, StatusPill } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';

const RETRY_MS = 3_000;

/** Storage that may be missing (private windows, blocked site data): never throws. */
const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // The queue still lives in memory for this page.
    }
  },
};

/**
 * The spotter's phone (M4.8c): type the paddle number, Enter. Keyboard first, 44 px targets. Each
 * entry is queued on the device with its own id (kept in the browser's storage, so a reload keeps
 * it) and synced when the network allows; the server records each id once and answers recorded,
 * duplicate (flagged for the recorder) or refused. The level and the event's paddle numbers come
 * over the spotters' channel, so an unknown number is refused on the device even offline. Never
 * names or amounts anyone gave (P4-13).
 */
export function Spotter({
  initial,
  streamUrl,
  syncUrl,
  storageKey,
}: {
  initial: SpotterStateDto;
  streamUrl: string;
  syncUrl: string;
  storageKey: string;
}) {
  const t = useTranslations('donations.spot');
  const locale = useLocale();
  const [state, setState] = useState(initial);
  const [queue, setQueue] = useState<SpotterQueue>(emptyQueue);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queueRef = useRef(queue);
  const busy = useRef(false);
  const restored = useRef(false);

  const stream = useRealtime(streamUrl, ['snapshot', 'state'], {
    snapshot: (d) => apply(d),
    state: (d) => apply(d),
  });
  function apply(d: unknown) {
    const next = d as SpotterStateDto | null;
    if (next && Array.isArray(next.paddles)) setState(next);
  }

  const save = useCallback(
    (q: SpotterQueue) => {
      queueRef.current = q;
      setQueue(q);
      storage.set(storageKey, JSON.stringify(q));
    },
    [storageKey],
  );

  const sync = useCallback(async () => {
    if (busy.current) return;
    const batch = nextBatch(queueRef.current);
    if (batch.length === 0) return;
    busy.current = true;
    setSyncing(true);
    try {
      const res = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ entries: batch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { results: { clientId: string; outcome: EntryOutcome }[] };
      save(settle(queueRef.current, body.results));
      setOnline(true);
    } catch {
      // No network or no answer: the entries stay queued and go again shortly.
      setOnline(false);
    } finally {
      busy.current = false;
      setSyncing(false);
    }
    // More than one batch waiting: keep going.
    if (queueRef.current.pending.length > 0 && nextBatch(queueRef.current).length > 0 && navigator.onLine)
      setTimeout(() => void sync(), 0);
  }, [save, syncUrl]);

  // Restore the queue from storage once, then keep trying while anything is waiting.
  useEffect(() => {
    if (!restored.current) {
      restored.current = true;
      save(restoreQueue(storage.get(storageKey)));
    }
    const tick = setInterval(() => {
      if (queueRef.current.pending.length > 0) void sync();
    }, RETRY_MS);
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    setOnline(navigator.onLine);
    return () => {
      clearInterval(tick);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [save, storageKey, sync]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const paddle = parsePaddleNumber(value);
    if (paddle === null) {
      setError(t('errors.number'));
      return;
    }
    if (!state.call) {
      setError(t('errors.noLevel'));
      return;
    }
    if (!state.paddles.includes(paddle)) {
      setError(t('errors.unknown', { number: paddle }));
      return;
    }
    setError(null);
    save(
      enqueue(queueRef.current, {
        clientId: crypto.randomUUID(),
        callId: state.call.id,
        paddle,
        recordedAt: new Date().toISOString(),
      }),
    );
    setValue('');
    setNotice(t('queued', { number: paddle }));
    input.current?.focus();
    void sync();
  }

  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const outcomeLabel = (o: EntryOutcome) =>
    o.status === 'refused' ? t(`refused.${o.reason}`) : t(`outcome.${o.status}`);
  const pendingCount = queue.pending.length;
  const recent: (SettledEntry | (SettledEntry & { waiting: true }))[] = [
    ...[...queue.pending]
      .reverse()
      .map((e) => ({ ...e, outcome: { status: 'recorded' as const }, waiting: true as const })),
    ...queue.settled,
  ].slice(0, 12);
  const errorId = 'paddle-error';
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <Card tone="feature" size="panel" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-label text-ink-2 uppercase">{t('calling')}</h2>
          <StatusPill
            tone={online && stream === 'live' ? 'success' : online ? 'neutral' : 'danger'}
            label={online ? (stream === 'live' ? t('online') : t('connecting')) : t('offline')}
          />
        </div>
        <p className="m-0 text-[24px] font-bold text-ink" data-testid="spot-level" aria-live="polite">
          {state.call
            ? t('levelLine', {
                amount: fmt(state.call.amountMinor, state.call.currency),
                name: state.call.levelName,
              })
            : t('waiting')}
        </p>
      </Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate aria-label={t('formLabel')}>
        <label htmlFor="paddle-number" className="text-[15px] font-bold text-ink">
          {t('numberLabel')}
        </label>
        <input
          ref={input}
          id="paddle-number"
          name="paddle"
          // biome-ignore lint/a11y/noAutofocus: the spotter's only task on this screen is typing numbers
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={5}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : 'paddle-hint'}
          className={cx('field field-lg w-full text-[28px] font-bold tabular-nums', error && 'field-invalid')}
        />
        {error ? (
          <p id={errorId} role="alert" className="m-0 text-body font-semibold text-danger">
            {error}
          </p>
        ) : (
          <p id="paddle-hint" className="m-0 text-caption text-ink-2">
            {t('numberHint')}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full">
          {t('record')}
        </Button>
      </form>
      <p role="status" className="m-0 min-h-6 text-body text-ink" data-testid="spot-notice">
        {notice}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-body text-ink" data-testid="spot-pending">
          {pendingCount > 0 ? t('pending', { count: pendingCount }) : t('allSent')}
        </p>
        {pendingCount > 0 ? (
          <Button type="button" variant="secondary" size="md" onClick={() => void sync()} disabled={syncing}>
            {t('sendNow')}
          </Button>
        ) : null}
      </div>
      <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
        <h2 id="recent-heading" className="m-0 text-label text-ink-2 uppercase">
          {t('recent')}
        </h2>
        {recent.length === 0 ? (
          <p className="m-0 text-caption text-ink-2">{t('noneYet')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-tile border border-line bg-surface p-0">
            {recent.map((e) => (
              <li key={e.clientId} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-[18px] font-bold text-ink tabular-nums">
                  {t('paddle', { number: e.paddle })}
                </span>
                <span
                  className={cx(
                    'text-caption',
                    'waiting' in e
                      ? 'text-ink-2'
                      : e.outcome.status === 'refused'
                        ? 'font-semibold text-danger'
                        : e.outcome.status === 'duplicate'
                          ? 'font-semibold text-warning'
                          : 'text-success',
                  )}
                >
                  {'waiting' in e ? t('outcome.waiting') : outcomeLabel(e.outcome)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
