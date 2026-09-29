/**
 * Follow a realtime channel from the Scan PWA (M3.4a). `EventSource` can't send the device's
 * bearer token, so this reads the same SSE stream (`/api/realtime/{channel}`) with fetch, resumes
 * with the last id, and reconnects after a growing pause. Messages carry no guest data; the
 * screen re-reads what it shows.
 */
export type StreamStatus = 'connecting' | 'live' | 'offline';

export function followChannel(opts: {
  readonly channel: string;
  readonly token: string;
  readonly onMessage: (event: string, data: unknown) => void;
  readonly onStatus?: (s: StreamStatus) => void;
}): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let lastId: string | null = null;
  let backoff = 2_000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispatch = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      else if (line.startsWith('id:')) lastId = line.slice(3).trim();
    }
    if (data.length === 0) return;
    try {
      opts.onMessage(event, JSON.parse(data.join('\n')));
    } catch {
      // Not JSON: ignore.
    }
  };

  const open = async () => {
    if (stopped) return;
    controller = new AbortController();
    opts.onStatus?.('connecting');
    try {
      const u = new URL(`/api/realtime/${encodeURIComponent(opts.channel)}`, window.location.href);
      if (lastId) u.searchParams.set('lastEventId', lastId);
      const res = await fetch(u, {
        headers: { authorization: `Bearer ${opts.token}`, accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      opts.onStatus?.('live');
      backoff = 2_000;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value.replace(/\r\n/g, '\n');
        let cut = buffer.indexOf('\n\n');
        while (cut >= 0) {
          dispatch(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
          cut = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Offline, refused or aborted: fall through to the retry.
    }
    if (stopped) return;
    opts.onStatus?.('offline');
    timer = setTimeout(() => void open(), backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
  void open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
