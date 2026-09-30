import { describe, expect, it, vi } from 'vitest';
import {
  ablyRealtimePublisher,
  ablySubscribeCapability,
  channelOrg,
  memoryRealtimeHub,
  orgChannel,
  type RealtimeMessage,
  realtimePublisherFromEnv,
} from '../src/realtime.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190b000-0000-7000-8000-00000000000b';
const E = '0190e000-0000-7000-8000-00000000000e';
const msg = (id: string): RealtimeMessage => ({ id, event: 'delta', data: { on: [], off: [id] } });

describe('realtime port (ADR 0009)', () => {
  it('channel names are always org-scoped and parse back to their org', () => {
    const c = orgChannel(A, 'event', E, 'seats');
    expect(c).toBe(`org:${A}:event:${E}:seats`);
    expect(channelOrg(c)).toBe(A);
    expect(channelOrg(`public:event:${E}:seats`)).toBeNull();
    expect(channelOrg(`org:not-a-uuid:event`)).toBeNull();
    expect(() => orgChannel('nope', 'event')).toThrow();
    expect(() => orgChannel(A, 'Event With Spaces')).toThrow();
  });

  it('the in-process hub delivers to a channel’s listeners only, until they unsubscribe', async () => {
    const hub = memoryRealtimeHub();
    const got: Record<string, string[]> = { a1: [], a2: [], b: [] };
    const ca = orgChannel(A, 'event', E, 'seats');
    const cb = orgChannel(B, 'event', E, 'seats');
    const off1 = hub.subscribe(ca, (m) => got.a1?.push(m.id));
    hub.subscribe(ca, (m) => got.a2?.push(m.id));
    hub.subscribe(cb, (m) => got.b?.push(m.id));
    expect(hub.listenerCount(ca)).toBe(2);
    await hub.publish(ca, msg('1'));
    off1();
    await hub.publish(ca, msg('2'));
    await hub.publish(cb, msg('3'));
    expect(got).toEqual({ a1: ['1'], a2: ['1', '2'], b: ['3'] });
    expect(hub.listenerCount(ca)).toBe(1);
    expect(() => hub.subscribe('public:event', () => {})).toThrow();
  });

  it('a failing listener never stops the others', async () => {
    const hub = memoryRealtimeHub();
    const c = orgChannel(A, 'x');
    const seen: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hub.subscribe(c, () => {
      throw new Error('boom');
    });
    hub.subscribe(c, (m) => seen.push(m.id));
    await hub.publish(c, msg('1'));
    expect(seen).toEqual(['1']);
    warn.mockRestore();
  });

  it('the Ably adapter posts the message to the channel with basic auth and never throws on failure', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = ablyRealtimePublisher({
      apiKey: 'app.key:secret',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response('{}', { status: 201 });
      },
    });
    const c = orgChannel(A, 'event', E, 'seats');
    await ok.publish(c, msg('7'));
    expect(calls[0]?.url).toBe(`https://rest.ably.io/channels/${encodeURIComponent(c)}/messages`);
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      `Basic ${Buffer.from('app.key:secret').toString('base64')}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      id: '7',
      name: 'delta',
      data: JSON.stringify({ on: [], off: ['7'] }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = ablyRealtimePublisher({
      apiKey: 'app.key:secret',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    await expect(down.publish(c, msg('8'))).resolves.toBeUndefined();
    warn.mockRestore();
    await expect(ok.publish('public:x', msg('9'))).rejects.toThrow();
    expect(() => ablyRealtimePublisher({ apiKey: 'no-colon' })).toThrow();
  });

  it('an Ably token capability names subscribe-only, org-scoped channels', () => {
    const c = orgChannel(A, 'event', E, 'seats');
    expect(ablySubscribeCapability([c])).toEqual({ [c]: ['subscribe'] });
    expect(() => ablySubscribeCapability(['*'])).toThrow();
  });

  it('config: SSE by default; Ably is added only with its key', async () => {
    const hub = memoryRealtimeHub();
    expect(realtimePublisherFromEnv(hub, {})).toBe(hub);
    expect(realtimePublisherFromEnv(hub, { REALTIME_PROVIDER: 'sse' })).toBe(hub);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(realtimePublisherFromEnv(hub, { REALTIME_PROVIDER: 'ably' })).toBe(hub);
    warn.mockRestore();
    expect(() =>
      realtimePublisherFromEnv(hub, {
        REALTIME_PROVIDER: 'ably',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      }),
    ).toThrow(/ABLY_API_KEY/);
    expect(() => realtimePublisherFromEnv(hub, { REALTIME_PROVIDER: 'pusher' })).toThrow();
    const posted: string[] = [];
    const both = realtimePublisherFromEnv(
      hub,
      { REALTIME_PROVIDER: 'ably', ABLY_API_KEY: 'a.b:c' },
      async (url) => {
        posted.push(url);
        return new Response('{}');
      },
    );
    expect(both.name).toBe('memory+ably');
    const c = orgChannel(A, 'event', E, 'seats');
    const local: string[] = [];
    hub.subscribe(c, (m) => local.push(m.id));
    await both.publish(c, msg('1'));
    expect(local).toEqual(['1']);
    expect(posted).toHaveLength(1);
  });
});
