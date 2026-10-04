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
const P = '01905000-0000-7000-8000-000000000009';

const CHAT = defineRealtimeChannel({
  scope: 'inbox',
  topic: 'chat',
  source: 'log',
  description: 'test',
  access: { own: true },
  events: { message: z.object({ id: z.string() }) },
});
const registry = createRealtimeRegistry([...CORE_REALTIME_CHANNELS, CHAT]);

describe('inbox-scoped realtime channels (M5.8b)', () => {
  it('wire names carry the org, event and inbox, and parse back', () => {
    const c = realtimeChannelName(CHAT, A, E, P);
    expect(c).toBe(`org:${A}:event:${E}:inbox:${P}:chat`);
    expect(c.length).toBeLessThanOrEqual(160);
    expect(parseRealtimeChannel(c)).toEqual({
      name: c,
      orgId: A,
      eventId: E,
      inboxId: P,
      scope: 'inbox',
      topic: 'chat',
    });
    expect(registry.resolve(c)?.def).toBe(CHAT);
  });

  it('an inbox channel needs a well-formed event and inbox', () => {
    expect(() => realtimeChannelName(CHAT, A, E)).toThrow();
    expect(() => realtimeChannelName(CHAT, A, null, P)).toThrow();
    expect(() => realtimeChannelName(CHAT, A, E, `${P}:x`)).toThrow();
    for (const bad of [
      `org:${A}:event:${E}:inbox:${P}:unknown`,
      `org:${A}:event:${E}:chat`,
      `org:${A}:event:${E}:session:${P}:chat`, // the session scope is not the inbox scope
      `org:${A}:event:${E}:inbox:${P}:chat:extra`,
      `org:${A}:inbox:${P}:chat`,
    ])
      expect(registry.resolve(bad), bad).toBeNull();
  });

  it('a channel attached only through its own route needs no other audience', () => {
    expect(() =>
      defineRealtimeChannel({
        scope: 'inbox',
        topic: 'x',
        source: 'log',
        description: 'x',
        access: {},
        events: {},
      }),
    ).toThrow(/audience/);
  });

  it('the generic attach refuses an inbox channel to everyone, its own org included', async () => {
    const c = registry.resolve(realtimeChannelName(CHAT, A, E, P));
    if (!c) throw new Error('unresolved');
    expect(await decideRealtimeAccess(c, { memberOrgId: A, can: () => true })).toBe('deny');
    expect(await decideRealtimeAccess(c, { memberOrgId: B, can: () => true })).toBe('deny');
    expect(await decideRealtimeAccess(c, { deviceOrgId: A })).toBe('deny');
    expect(await decideRealtimeAccess(c, {})).toBe('deny');
  });
});
