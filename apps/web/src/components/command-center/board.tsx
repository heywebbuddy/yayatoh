'use client';

import { moveWidget, type WidgetChannel, type WidgetKey } from '@yayatoh/command-center/client';
import { Button, Card, cx, Label, StatusDot } from '@yayatoh/ui';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';
import { WidgetBody } from './widgets.tsx';

interface Slot {
  readonly key: WidgetKey;
  readonly size: 'sm' | 'md' | 'lg';
  readonly hidden: boolean;
}

type LayoutResult = { ok: boolean; code: string | null };
type Params = Readonly<Record<string, string>>;
type Urls = Partial<Record<WidgetChannel, string>>;

/** Messages per channel that mean "something changed" (the widget then re-reads its loader). */
const CHANNEL_EVENTS: Readonly<Record<WidgetChannel, readonly string[]>> = {
  'event.checkins': ['admission', 'scan', 'snapshot'],
  'event.devices': ['device', 'snapshot'],
  'event.metrics': ['metric', 'snapshot'],
  'org.alerts': ['alert', 'snapshot'],
};
const POLL_MS = 30_000;
const SPAN: Record<Slot['size'], string> = { sm: '', md: 'md:col-span-2', lg: 'md:col-span-2 xl:col-span-3' };
const DOT = { live: 'success', connecting: 'warning', offline: 'neutral' } as const;

/** Follows one channel; each message (after the first snapshot) calls `onChange`. */
function ChannelWatch({
  url,
  events,
  onChange,
  onState,
}: {
  url: string;
  events: readonly string[];
  onChange: () => void;
  onState: (s: 'connecting' | 'live' | 'offline') => void;
}) {
  const first = useRef(true);
  const handlers = Object.fromEntries(
    events.map((e) => [
      e,
      () => {
        if (e === 'snapshot' && first.current) {
          first.current = false;
          return;
        }
        onChange();
      },
    ]),
  );
  const state = useRealtime(url, events, handlers);
  useEffect(() => onState(state), [state, onState]);
  return null;
}

/**
 * The Command Center board (M3.2a): the member's widgets for the current mode, kept current over
 * each widget's realtime channel (or every 30 s when the member can't follow it), and arranged by
 * the member: drag a widget by its handle, or use the Move up / Move down / Hide / Show buttons
 * (the keyboard alternative). Every change is saved at once for this member and this event.
 */
export function CommandCenterBoard({
  slots,
  channels,
  urls,
  initial,
  widgetUrl,
  base,
  locale,
  timeZone,
  serverNow,
  nextChangeAt,
  save,
  reset,
}: {
  slots: readonly Slot[];
  channels: Readonly<Record<string, readonly WidgetChannel[]>>;
  urls: Urls;
  initial: Readonly<Record<string, unknown>>;
  widgetUrl: string;
  base: string;
  locale: string;
  timeZone: string;
  serverNow: string;
  nextChangeAt: string | null;
  save: (order: string[], hidden: string[]) => Promise<LayoutResult>;
  reset: () => Promise<LayoutResult>;
}) {
  const t = useTranslations('commandCenter');
  const router = useRouter();
  const [order, setOrder] = useState<WidgetKey[]>(() => slots.map((s) => s.key));
  const [hidden, setHidden] = useState<Set<WidgetKey>>(
    () => new Set(slots.filter((s) => s.hidden).map((s) => s.key)),
  );
  const [data, setData] = useState<Record<string, unknown>>(() => ({ ...initial }));
  const [customizing, setCustomizing] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [streams, setStreams] = useState<Record<string, 'connecting' | 'live' | 'offline'>>({});
  const [dragging, setDragging] = useState<WidgetKey | null>(null);
  // M3.3a: widget options (the live feed's filters), paused widgets, and news waiting while paused.
  const [params, setParamsState] = useState<Record<string, Params>>({});
  const [paused, setPaused] = useState<Set<WidgetKey>>(() => new Set());
  const [waiting, setWaiting] = useState<Set<WidgetKey>>(() => new Set());
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [, startTransition] = useTransition();
  const refocus = useRef<string | null>(null);
  const size = new Map(slots.map((s) => [s.key, s.size]));
  const title = (k: WidgetKey) => t(`widget.${k}.title`);

  // Only the latest re-read of a widget lands (a slow one started before a filter change never
  // overwrites the newer answer).
  const latest = useRef(new Map<string, number>());
  const refetch = useCallback(
    async (key: WidgetKey, p?: Params) => {
      const qs = new URLSearchParams(Object.entries(p ?? paramsRef.current[key] ?? {})).toString();
      const seq = (latest.current.get(key) ?? 0) + 1;
      latest.current.set(key, seq);
      try {
        const res = await fetch(`${widgetUrl}/${key}${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
        if (!res.ok || latest.current.get(key) !== seq) return;
        const body = (await res.json()) as { data: unknown };
        if (latest.current.get(key) !== seq) return;
        setData((d) => ({ ...d, [key]: body.data }));
      } catch {
        // Offline for a moment: the next message or poll re-reads.
      }
    },
    [widgetUrl],
  );

  // One re-read per burst of messages, per channel.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const visible = order.filter((k) => !hidden.has(k));
  const visibleKey = visible.join(',');
  const changed = useCallback(
    (channel: WidgetChannel) => {
      if (timers.current.has(channel)) return;
      timers.current.set(
        channel,
        setTimeout(() => {
          timers.current.delete(channel);
          for (const k of visibleKey.split(',') as WidgetKey[]) {
            if (!channels[k]?.includes(channel)) continue;
            // A paused widget keeps what it shows; it says there is news and catches up on resume.
            if (pausedRef.current.has(k)) setWaiting((w) => (w.has(k) ? w : new Set(w).add(k)));
            else void refetch(k);
          }
        }, 250),
      );
    },
    [channels, refetch, visibleKey],
  );
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
    };
  }, []);

  // Widgets with no channel the member can follow are re-read on a timer.
  useEffect(() => {
    const polled = (visibleKey.split(',') as WidgetKey[]).filter((k) => {
      const ch = channels[k] ?? [];
      return k && !ch.some((c) => urls[c]);
    });
    if (polled.length === 0) return;
    const id = setInterval(() => {
      for (const k of polled) void refetch(k);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [channels, urls, refetch, visibleKey]);

  // The mode changes at `nextChangeAt` (server clock): re-render the page then.
  useEffect(() => {
    if (!nextChangeAt) return;
    const delay = new Date(nextChangeAt).getTime() - new Date(serverNow).getTime() + 1_000;
    if (delay < 0 || delay > 24 * 3_600_000) return;
    const id = setTimeout(() => router.refresh(), delay);
    return () => clearTimeout(id);
  }, [nextChangeAt, serverNow, router]);

  useEffect(() => {
    if (!refocus.current) return;
    const el = document.querySelector<HTMLElement>(`[data-cc-focus="${refocus.current}"]`);
    refocus.current = null;
    el?.focus();
  });

  const persist = (nextOrder: WidgetKey[], nextHidden: Set<WidgetKey>, done: string) => {
    setOrder(nextOrder);
    setHidden(nextHidden);
    startTransition(async () => {
      const r = await save(nextOrder, [...nextHidden]);
      setFailed(!r.ok);
      setMessage(r.ok ? done : t('saveFailed'));
    });
  };
  const move = (key: WidgetKey, delta: -1 | 1) => {
    const shown = moveWidget(visible, key, delta);
    const next = [...shown, ...order.filter((k) => hidden.has(k))];
    refocus.current = `${key}:${delta < 0 ? 'up' : 'down'}`;
    const at = shown.indexOf(key);
    // At the edge the button is disabled; keep focus on the other one.
    if ((delta < 0 && at === 0) || (delta > 0 && at === shown.length - 1))
      refocus.current = `${key}:${delta < 0 ? 'down' : 'up'}`;
    persist(next, hidden, t('moved', { widget: title(key), position: at + 1 }));
  };
  const hide = (key: WidgetKey) => {
    const next = new Set(hidden).add(key);
    refocus.current = `${key}:show`;
    persist(order, next, t('hiddenMsg', { widget: title(key) }));
  };
  const show = (key: WidgetKey) => {
    const next = new Set(hidden);
    next.delete(key);
    // Shown widgets go to the end of the visible ones.
    const nextOrder = [
      ...order.filter((k) => !next.has(k) && k !== key),
      key,
      ...order.filter((k) => next.has(k)),
    ];
    refocus.current = `${key}:hide`;
    persist(nextOrder, next, t('shownMsg', { widget: title(key) }));
    if (data[key] === undefined) void refetch(key);
  };
  const drop = (target: WidgetKey) => {
    if (!dragging || dragging === target) return;
    const shown = visible.filter((k) => k !== dragging);
    shown.splice(shown.indexOf(target), 0, dragging);
    persist(
      [...shown, ...order.filter((k) => hidden.has(k))],
      hidden,
      t('moved', { widget: title(dragging), position: shown.indexOf(dragging) + 1 }),
    );
    setDragging(null);
  };
  const resetLayout = () =>
    startTransition(async () => {
      const r = await reset();
      setFailed(!r.ok);
      setMessage(r.ok ? t('resetDone') : t('saveFailed'));
      if (r.ok) router.refresh();
    });

  const followed = [...new Set(visible.flatMap((k) => (channels[k] ?? []).filter((c) => urls[c])))];
  const liveState =
    followed.length === 0
      ? 'polling'
      : followed.every((c) => streams[c] === 'live')
        ? 'live'
        : followed.some((c) => streams[c] === 'offline')
          ? 'offline'
          : 'connecting';
  const onState = useCallback(
    (c: string, s: 'connecting' | 'live' | 'offline') =>
      setStreams((m) => (m[c] === s ? m : { ...m, [c]: s })),
    [],
  );
  const ctx = { locale, timeZone, base };
  const controls = (k: WidgetKey) => ({
    params: params[k] ?? {},
    setParams: (next: Params) => {
      paramsRef.current = { ...paramsRef.current, [k]: next };
      setParamsState((m) => ({ ...m, [k]: next }));
      void refetch(k, next);
    },
    paused: paused.has(k),
    waiting: waiting.has(k),
    togglePause: () => {
      const next = new Set(paused);
      if (next.has(k)) {
        next.delete(k);
        setWaiting((w) => {
          const n = new Set(w);
          n.delete(k);
          return n;
        });
        void refetch(k);
      } else next.add(k);
      setPaused(next);
    },
  });

  return (
    <section aria-labelledby="cc-widgets" className="flex flex-col gap-4">
      {followed.map((c) => (
        <ChannelWatch
          key={c}
          url={urls[c] as string}
          events={CHANNEL_EVENTS[c]}
          onChange={() => changed(c)}
          onState={(s) => onState(c, s)}
        />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cc-widgets" className="text-section">
          {t('widgets')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="cc-live" data-live={liveState}>
            <StatusDot
              status={liveState === 'polling' ? 'info' : DOT[liveState]}
              label={t(`live.${liveState}`)}
              live={liveState === 'live'}
            />
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={customizing}
            onClick={() => setCustomizing((v) => !v)}
          >
            {customizing ? t('done') : t('customize')}
          </Button>
          {customizing ? (
            <Button variant="ghost" size="sm" onClick={resetLayout}>
              {t('reset')}
            </Button>
          ) : null}
        </div>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cx('text-caption', failed ? 'text-pink-700' : 'text-zinc-600')}
      >
        {message}
      </p>
      {visible.length === 0 ? (
        <Card className="text-center">
          <p className="text-section">{t('empty.title')}</p>
          <p className="text-body text-zinc-600">{t('empty.description')}</p>
        </Card>
      ) : (
        <ol
          className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3"
          aria-label={t('widgets')}
        >
          {visible.map((k, i) => (
            <li
              key={k}
              className={cx(SPAN[size.get(k) ?? 'sm'], dragging === k && 'opacity-60')}
              data-testid={`cc-widget-${k}`}
              onDragOver={customizing ? (e) => e.preventDefault() : undefined}
              onDrop={customizing ? () => drop(k) : undefined}
            >
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0">
                    <Label>{title(k)}</Label>
                  </h3>
                  {customizing ? (
                    <div className="flex items-center gap-1">
                      <span
                        draggable
                        onDragStart={() => setDragging(k)}
                        onDragEnd={() => setDragging(null)}
                        className="inline-flex size-7 cursor-grab items-center justify-center rounded-pill text-zinc-500"
                        title={t('drag', { widget: title(k) })}
                        aria-hidden="true"
                      >
                        <GripVertical className="size-4" />
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('moveUp', { widget: title(k) })}
                        data-cc-focus={`${k}:up`}
                        disabled={i === 0}
                        onClick={() => move(k, -1)}
                      >
                        <ArrowUp aria-hidden="true" className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('moveDown', { widget: title(k) })}
                        data-cc-focus={`${k}:down`}
                        disabled={i === visible.length - 1}
                        onClick={() => move(k, 1)}
                      >
                        <ArrowDown aria-hidden="true" className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('hide', { widget: title(k) })}
                        data-cc-focus={`${k}:hide`}
                        onClick={() => hide(k)}
                      >
                        <EyeOff aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                {data[k] === undefined ? (
                  <p className="text-caption text-zinc-500">{t('loading')}</p>
                ) : data[k] === null ? (
                  <p className="text-caption text-zinc-600">{t('unavailable')}</p>
                ) : (
                  <WidgetBody widget={k} data={data[k]} ctx={ctx} controls={controls(k)} />
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
      {customizing ? (
        <section aria-labelledby="cc-hidden" className="flex flex-col gap-2">
          <h3 id="cc-hidden" className="text-body font-medium">
            {t('hiddenTitle')}
          </h3>
          {order.some((k) => hidden.has(k)) ? (
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {order
                .filter((k) => hidden.has(k))
                .map((k) => (
                  <li key={k}>
                    <Button variant="secondary" size="sm" data-cc-focus={`${k}:show`} onClick={() => show(k)}>
                      <Eye aria-hidden="true" className="size-4" />
                      {t('show', { widget: title(k) })}
                    </Button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-caption text-zinc-600">{t('hiddenNone')}</p>
          )}
        </section>
      ) : null}
    </section>
  );
}
