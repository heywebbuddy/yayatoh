import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeMessage } from '../src/realtime.ts';
import { memoryRealtimeHub } from '../src/realtime.ts';
import { formatSse, lastEventIdOf, type SseSource, StreamLimits, sseStream } from '../src/realtime-sse.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const CH = `org:${A}:event:0190e000-0000-7000-8000-00000000000e:checkins`;
const m = (id: string, event = 'admission', data: unknown = { n: Number(id) }): RealtimeMessage => ({
  id,
  event,
  data,
});

/** Read what the stream has produced so far (until `until` holds, it ends, or time runs out). */
async function readUntil(stream: ReadableStream<Uint8Array>, until: (text: string) => boolean, ms = 2_000) {
  const reader = stream.getReader();
  let text = '';
  const deadline = Date.now() + ms;
  let next = reader.read();
  while (!until(text) && Date.now() < deadline) {
    const r = await Promise.race([next, new Promise<null>((res) => setTimeout(() => res(null), 50))]);
    if (r === null) continue;
    if (r.done) break;
    text += new TextDecoder().decode(r.value);
    next = reader.read();
  }
  next.catch(() => {});
  void reader.cancel().catch(() => {});
  return text;
}

const ids = (text: string) => [...text.matchAll(/^id: (.+)$/gm)].map((x) => x[1]);

afterEach(() => {
  vi.useRealTimers();
});

describe('SSE core (M3.1b)', () => {
  it('frames messages safely: one data line, no injected fields', () => {
    expect(formatSse(m('7', 'delta', { a: 'x\ny' }))).toBe('id: 7\nevent: delta\ndata: {"a":"x\\ny"}\n\n');
    expect(formatSse({ id: '1\nevent: evil', event: 'a\r\nb', data: null })).toBe(
      'id: 1event: evil\nevent: ab\ndata: null\n\n',
    );
  });

  it('reads Last-Event-ID from the header first, then the query; ignores oversized ids', () => {
    expect(
      lastEventIdOf(new Request('http://x/s?lastEventId=5', { headers: { 'last-event-id': '9' } })),
    ).toBe('9');
    expect(lastEventIdOf(new Request('http://x/s?lastEventId=5'))).toBe('5');
    expect(lastEventIdOf(new Request('http://x/s'))).toBeNull();
    expect(lastEventIdOf(new Request(`http://x/s?lastEventId=${'1'.repeat(81)}`))).toBeNull();
  });

  it('sends retry, then the catch-up, then live messages; nothing twice when they overlap', async () => {
    const hub = memoryRealtimeHub();
    let resolveCatchUp: (v: RealtimeMessage[]) => void = () => {};
    const source: SseSource = {
      subscribe: (l) => hub.subscribe(CH, l),
      catchUp: (last) => {
        expect(last).toBe('3');
        return new Promise((r) => {
          resolveCatchUp = r;
        });
      },
    };
    const { stream } = sseStream({ source, lastEventId: '3' });
    const reading = readUntil(stream, (t) => ids(t).length >= 4);
    await new Promise((r) => setTimeout(r, 10));
    // Live messages published while the catch-up is still being read wait for it.
    await hub.publish(CH, m('5'));
    await hub.publish(CH, m('6'));
    resolveCatchUp([m('4'), m('5')]);
    await new Promise((r) => setTimeout(r, 10));
    await hub.publish(CH, m('7'));
    const text = await reading;
    expect(text.startsWith('retry: 2000\n\n')).toBe(true);
    expect(ids(text)).toEqual(['4', '5', '6', '7']);
  });

  it('serializes every message through the allowlist and drops what it refuses', async () => {
    const hub = memoryRealtimeHub();
    const { stream } = sseStream({
      source: {
        subscribe: (l) => hub.subscribe(CH, l),
        catchUp: () => [m('1', 'snapshot', { ok: 1, secret: 2 })],
      },
      lastEventId: null,
      serialize: (x) =>
        x.event === 'bad' ? null : { ...x, data: { ok: (x.data as { ok?: number }).ok ?? 0 } },
    });
    const reading = readUntil(stream, (t) => ids(t).includes('3'));
    await new Promise((r) => setTimeout(r, 10));
    await hub.publish(CH, m('2', 'bad'));
    await hub.publish(CH, m('3', 'admission', { ok: 3, holder: 'Ada' }));
    const text = await reading;
    expect(ids(text)).toEqual(['1', '3']);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Ada');
  });

  it('sends a heartbeat comment while idle', async () => {
    const { stream } = sseStream({
      source: { subscribe: () => () => {}, catchUp: () => [] },
      lastEventId: null,
      pingMs: 20,
    });
    expect(await readUntil(stream, (t) => t.includes(': ping'))).toContain(': ping\n\n');
  });

  it('lets go of a client that stops reading (backpressure) and releases its subscription', async () => {
    const hub = memoryRealtimeHub();
    const released = vi.fn();
    const closed = vi.fn();
    const { stream } = sseStream({
      source: { subscribe: (l) => hub.subscribe(CH, l), catchUp: () => [], release: released },
      lastEventId: null,
      maxBufferedBytes: 4 * 1024,
      onClose: closed,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(hub.listenerCount(CH)).toBe(1);
    // Nobody reads: the queue grows past the high-water mark plus the allowance.
    const big = 'x'.repeat(8 * 1024);
    for (let i = 1; i <= 20 && hub.listenerCount(CH) > 0; i++)
      await hub.publish(CH, m(String(i), 'admission', big));
    expect(hub.listenerCount(CH)).toBe(0);
    expect(released).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    void stream.cancel().catch(() => {});
  });

  it('ends when the client goes away, and when the server closes it', async () => {
    const hub = memoryRealtimeHub();
    const ctrl = new AbortController();
    const onClose = vi.fn();
    sseStream({
      source: { subscribe: (l) => hub.subscribe(CH, l), catchUp: () => [] },
      lastEventId: null,
      signal: ctrl.signal,
      onClose,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(hub.listenerCount(CH)).toBe(1);
    ctrl.abort();
    expect(hub.listenerCount(CH)).toBe(0);
    expect(onClose).toHaveBeenCalledTimes(1);

    const s = sseStream({
      source: { subscribe: (l) => hub.subscribe(CH, l), catchUp: () => [] },
      lastEventId: null,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(hub.listenerCount(CH)).toBe(1);
    s.close();
    s.close();
    expect(hub.listenerCount(CH)).toBe(0);
    const reader = s.stream.getReader();
    let done = false;
    while (!done) done = (await reader.read()).done;
    expect(done).toBe(true);
  });

  it('a failing catch-up ends the stream (the client reconnects) instead of hanging', async () => {
    const hub = memoryRealtimeHub();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = sseStream({
      source: { subscribe: (l) => hub.subscribe(CH, l), catchUp: () => Promise.reject(new Error('db down')) },
      lastEventId: '4',
    });
    const reader = s.stream.getReader();
    let done = false;
    while (!done) done = (await reader.read()).done;
    expect(hub.listenerCount(CH)).toBe(0);
    warn.mockRestore();
  });
});

describe('stream limits (M3.1b)', () => {
  it('caps streams per org and per process, and frees a slot once, on release', () => {
    const limits = new StreamLimits({ perProcess: 3, perOrg: 2 });
    const a1 = limits.open('a', () => {});
    const a2 = limits.open('a', () => {});
    expect(a1 && a2).toBeTruthy();
    expect(limits.refusal('a')).toBe('org');
    expect(limits.open('a', () => {})).toBeNull();
    const b1 = limits.open('b', () => {});
    expect(b1).toBeTruthy();
    expect(limits.refusal('c')).toBe('process');
    a1?.();
    a1?.();
    expect(limits.count('a')).toBe(1);
    expect(limits.count()).toBe(2);
    expect(limits.refusal('a')).toBeNull();
  });

  it('closeAll ends every open stream', () => {
    const limits = new StreamLimits({ perProcess: 10, perOrg: 10 });
    const closed: string[] = [];
    const rel: (() => void)[] = [];
    for (const org of ['a', 'a', 'b']) {
      const r = limits.open(org, () => {
        closed.push(org);
        r?.();
      });
      if (r) rel.push(r);
    }
    expect(limits.closeAll()).toBe(3);
    expect(closed.sort()).toEqual(['a', 'a', 'b']);
    expect(limits.count()).toBe(0);
  });
});
