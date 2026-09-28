'use client';

import { useEffect, useRef, useState } from 'react';

export type StreamState = 'connecting' | 'live' | 'offline';

export interface SeatStreamHandlers {
  /** The whole state (first connection, or after a gap too long to replay). */
  readonly onSnapshot: (data: unknown) => void;
  /** What changed since the last message. */
  readonly onDelta: (data: unknown) => void;
  /** The map itself changed (seats priced, repriced, added): reload it. */
  readonly onRefresh: () => void;
}

/**
 * Subscribe to a live seat stream (M1.7f, Server-Sent Events). The browser reconnects a dropped
 * stream by itself and sends the last message id (Last-Event-ID), so the server replays what was
 * missed. If the server refuses a connection (busy, rate-limited, restarted), the stream is
 * reopened after a growing pause, from the last id when there is one, else from a snapshot.
 */
export function useSeatStream(url: string | null, handlers: SeatStreamHandlers): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const current = useRef(handlers);
  current.current = handlers;
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
      es.addEventListener('snapshot', (e) => current.current.onSnapshot(parse(e as MessageEvent<string>)));
      es.addEventListener('delta', (e) => current.current.onDelta(parse(e as MessageEvent<string>)));
      es.addEventListener('refresh', (e) => {
        parse(e as MessageEvent<string>);
        current.current.onRefresh();
      });
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
  }, [url]);
  return state;
}
