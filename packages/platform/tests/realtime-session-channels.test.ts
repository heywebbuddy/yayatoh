import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CORE_REALTIME_CHANNELS,
  createRealtimeRegistry,
  decideRealtimeAccess,
  defineRealtimeChannel,
  parseRealtimeChannel,
  realtimeChannelName,
} from '../src/realtime-channels.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190b000-0000-7000-8000-00000000000b';
const E = '0190e000-0000-7000-8000-00000000000e';
const S = '01905000-0000-7000-8000-000000000005';

const LIVE = defineRealtimeChannel({
  scope: 'session',
  topic: 'live',
  source: 'log',
  description: 'test',
  access: { public: true },
  events: { poll: z.object({ id: z.string() }) },
});
const MOD = defineRealtimeChannel({
  scope: 'session',
  topic: 'moderation',
  source: 'log',
  description: 'test',
  access: { permission: 'events:read' },
  events: { question: z.object({ id: z.string() }) },
});
const registry = createRealtimeRegistry([...CORE_REALTIME_CHANNELS, LIVE, MOD]);

describe('session-scoped realtime channels (M5.7a)', () => {
  it('wire names carry the org, event and session, and parse back', () => {
    const c = realtimeChannelName(LIVE, A, E, S);
    expect(c).toBe(`org:${A}:event:${E}:session:${S}:live`);
    expect(c.length).toBeLessThanOrEqual(160);
    expect(parseRealtimeChannel(c)).toEqual({
      name: c,
      orgId: A,
      eventId: E,
      sessionId: S,
      scope: 'session',
      topic: 'live',
    });
    expect(registry.resolve(c)?.def).toBe(LIVE);
    expect(registry.resolve(realtimeChannelName(MOD, A, E, S))?.def).toBe(MOD);
  });

  it('a session channel needs a well-formed event and session', () => {
    expect(() => realtimeChannelName(LIVE, A, E)).toThrow();
    expect(() => realtimeChannelName(LIVE, A, null, S)).toThrow();
    expect(() => realtimeChannelName(LIVE, A, E, `${S}:x`)).toThrow();
    expect(() => realtimeChannelName(LIVE, A, E, 'nope')).toThrow();
    for (const bad of [
      `org:${A}:event:${E}:session:${S}:unknown`,
      `org:${A}:event:${E}:live`, // a session channel without its session
      `org:${A}:event:${E}:session:${S}:checkins`, // an event channel inside a session
      `org:${A}:event:${E}:session:${S}:live:extra`,
      `org:${A}:session:${S}:live`,
    ])
      expect(registry.resolve(bad), bad).toBeNull();
  });

  it('session topics are short enough to keep wire names within 160 characters', () => {
    expect(() =>
      defineRealtimeChannel({
        scope: 'session',
        topic: 'a-very-long-topic-name-x',
        source: 'log',
        description: 'x',
        access: { public: true },
        events: {},
      }),
    ).toThrow(/topic/);
  });

  it('another org never attaches to a private session channel', async () => {
    const c = registry.resolve(realtimeChannelName(MOD, A, E, S));
    if (!c) throw new Error('unresolved');
    expect(await decideRealtimeAccess(c, { memberOrgId: A, can: () => true })).toBe('allow');
    expect(await decideRealtimeAccess(c, { memberOrgId: B, can: () => true })).toBe('deny');
    expect(await decideRealtimeAccess(c, { deviceOrgId: A })).toBe('deny');
    expect(await decideRealtimeAccess(c, {})).toBe('deny');
    const live = registry.resolve(realtimeChannelName(LIVE, A, E, S));
    if (!live) throw new Error('unresolved');
    // The public live channel: anyone, as the public (the app then runs its public check).
    expect(await decideRealtimeAccess(live, { memberOrgId: B, can: () => true })).toBe('public');
  });
});
