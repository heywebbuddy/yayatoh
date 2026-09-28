'use client';

import { useEffect, useRef, useState } from 'react';

export type StreamState = 'connecting' | 'live' | 'offline';

/** Handlers by message type (`snapshot`, `delta`, `admission`, …); each gets the parsed data. */
export type RealtimeHandlers = Readonly<Record<string, (data: unknown) => void>>;

/**
 * Follow a realtime channel over Server-Sent Events (M3.1b; M1.7f for the seat map). The browser
 * reconnects a dropped stream by itself and sends the last message id (Last-Event-ID), so the
 * server replays what was missed. If the server refuses a connection (busy, rate-limited,
 * restarted), the stream is reopened after a growing pause, from the last id when there is one,
 * else from a snapshot. `events` lists the message types to listen for (fixed per caller).
 */
export function useRealtime(
  url: string | null,
  events: readonly string[],
  handlers: RealtimeHandlers,
): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const current = useRef(handlers);
  current.current = handlers;
  const names = events.join(',');
  useEffect(() => {
    if (!url || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let lastId: string | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 2_000;
    let stopped = false;
    const parse = (e: MessageEvent<string>) => {
      if (e.lastEventId) lastId = e.lastEventId;
      try {
        return JSON.parse(e.data) as unknown;
      } catch {
        return null;
      }
    };
    const open = () => {
      if (stopped) return;
      const u = new URL(url, window.location.href);
      if (lastId) u.searchParams.set('lastEventId', lastId);
      const es = new EventSource(u.toString());
      source = es;
      setState('connecting');
      es.addEventListener('open', () => {
        backoff = 2_000;
        setState('live');
      });
      for (const name of names.split(',')) {
        if (!name) continue;
        es.addEventListener(name, (e) => {
          const data = parse(e as MessageEvent<string>);
          current.current[name]?.(data);
        });
      }
      es.addEventListener('error', () => {
        // CONNECTING: the browser retries by itself (with Last-Event-ID). CLOSED: we do.
        if (es.readyState === EventSource.CLOSED) {
          setState('offline');
          es.close();
          retry = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 30_000);
        } else setState('connecting');
      });
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [url, names]);
  return state;
}
