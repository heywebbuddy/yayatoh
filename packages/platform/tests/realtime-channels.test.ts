import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ablyTokenRequest, realtimeProvider } from '../src/realtime.ts';
import {
  ALERTS_CHANNEL,
  CHECKINS_CHANNEL,
  CORE_REALTIME_CHANNELS,
  createRealtimeRegistry,
  DEVICES_CHANNEL,
  decideRealtimeAccess,
  defineRealtimeChannel,
  METRICS_CHANNEL,
  parseRealtimeChannel,
  realtimeChannelName,
  realtimePayload,
} from '../src/realtime-channels.ts';
import { parseRealtimeId } from '../src/realtime-log.ts';
import { ABLY_CONNECT_SOURCES, realtimeConnectSources } from '../src/security/realtime-csp.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190b000-0000-7000-8000-00000000000b';
const E = '0190e000-0000-7000-8000-00000000000e';
const CP = '0190c000-0000-7000-8000-00000000000c';

const PUBLIC_SEATS = defineRealtimeChannel({
  scope: 'event',
  topic: 'seats',
  source: 'feed',
  description: 'test',
  access: { public: true },
  events: { snapshot: z.object({ on: z.array(z.string()) }) },
});
const registry = createRealtimeRegistry([...CORE_REALTIME_CHANNELS, PUBLIC_SEATS]);

describe('realtime channel registry (M3.1b)', () => {
  it('wire names are org-scoped, event channels carry the event, and parse back', () => {
    const c = realtimeChannelName(CHECKINS_CHANNEL, A, E);
    expect(c).toBe(`org:${A}:event:${E}:checkins`);
    expect(parseRealtimeChannel(c)).toEqual({
      name: c,
      orgId: A,
      eventId: E,
      scope: 'event',
      topic: 'checkins',
    });
    const o = realtimeChannelName(ALERTS_CHANNEL, A);
    expect(o).toBe(`org:${A}:alerts`);
    expect(parseRealtimeChannel(o)).toMatchObject({ orgId: A, eventId: null, scope: 'org', topic: 'alerts' });
    // An event channel needs an event; ids must be uuids.
    expect(() => realtimeChannelName(CHECKINS_CHANNEL, A)).toThrow();
    expect(() => realtimeChannelName(CHECKINS_CHANNEL, 'nope', E)).toThrow();
    expect(() => realtimeChannelName(CHECKINS_CHANNEL, A, `${E}:x`)).toThrow();
  });

  it('resolves only registered, well-formed channels', () => {
    expect(registry.resolve(`org:${A}:event:${E}:checkins`)?.def).toBe(CHECKINS_CHANNEL);
    expect(registry.resolve(`org:${A}:event:${E}:devices`)?.def).toBe(DEVICES_CHANNEL);
    expect(registry.resolve(`org:${A}:event:${E}:metrics`)?.def).toBe(METRICS_CHANNEL);
    expect(registry.resolve(`org:${A}:alerts`)?.def).toBe(ALERTS_CHANNEL);
    for (const bad of [
      `org:${A}:event:${E}:unknown`,
      `org:${A}:checkins`, // an event channel without its event
      `org:${A}:event:${E}:alerts`, // an org channel inside an event
      `org:${A}:event:${E}:checkins:extra`,
      `org:${A.toUpperCase()}:alerts`,
      `public:event:${E}:seats`,
      `org:${A}:event:${E}:checkins\n`,
      `org:../${A}:alerts`,
      '',
      `org:${A}:${'x'.repeat(200)}`,
    ])
      expect(registry.resolve(bad), bad).toBeNull();
  });

  it('refuses ill-defined channels and duplicates', () => {
    expect(() =>
      defineRealtimeChannel({
        scope: 'org',
        topic: 'Bad Topic',
        source: 'log',
        description: '',
        access: { public: true },
        events: {},
      }),
    ).toThrow(/topic/);
    expect(() =>
      defineRealtimeChannel({
        scope: 'org',
        topic: 'nobody',
        source: 'log',
        description: '',
        access: {},
        events: {},
      }),
    ).toThrow(/audience/);
    expect(() =>
      defineRealtimeChannel({
        scope: 'org',
        topic: 'x',
        source: 'log',
        description: '',
        access: { public: true },
        events: { snapshot: z.object({}) },
      }),
    ).toThrow(/reserved/);
    expect(() => createRealtimeRegistry([ALERTS_CHANNEL, ALERTS_CHANNEL])).toThrow(/twice/);
  });

  it('payloads pass through the channel allowlist: extra fields dropped, unknown events and bad data refused', () => {
    const at = '2026-09-28T10:00:00.000Z';
    expect(
      realtimePayload(CHECKINS_CHANNEL, 'admission', {
        change: 'admitted',
        checkpointId: CP,
        count: 1,
        at,
        ticketId: 'secret',
        holderName: 'Ada',
      }),
    ).toEqual({ change: 'admitted', checkpointId: CP, count: 1, at });
    expect(() => realtimePayload(CHECKINS_CHANNEL, 'deleted', {})).toThrow(/does not carry/);
    expect(() => realtimePayload(CHECKINS_CHANNEL, 'toString', {})).toThrow(/does not carry/);
    expect(() =>
      realtimePayload(CHECKINS_CHANNEL, 'admission', {
        change: 'admitted',
        checkpointId: null,
        count: 0,
        at,
      }),
    ).toThrow();
    // Snapshots have their own allowlist; refresh carries nothing.
    expect(
      realtimePayload(CHECKINS_CHANNEL, 'snapshot', { admitted: 3, tickets: 2, holders: ['x'] }),
    ).toEqual({
      admitted: 3,
      tickets: 2,
    });
    expect(realtimePayload(ALERTS_CHANNEL, 'snapshot', { anything: 1 })).toEqual({});
    expect(realtimePayload(CHECKINS_CHANNEL, 'refresh', { x: 1 })).toEqual({});
    expect(() =>
      realtimePayload(METRICS_CHANNEL, 'metric', { metric: 'Revenue; drop', value: 1, at }),
    ).toThrow();
    expect(realtimePayload(PUBLIC_SEATS, 'snapshot', { on: ['a'], off: ['b'] })).toEqual({ on: ['a'] });
  });

  it('resume ids: only positive log ids are resumable', () => {
    expect(parseRealtimeId('42')).toBe(42);
    expect(parseRealtimeId('900719925474099')).toBe(900719925474099);
    for (const bad of [
      null,
      undefined,
      '',
      '0',
      '-1',
      '01',
      '1.5',
      'abc-3',
      '1e3',
      '9'.repeat(16),
      '42 ',
      ' 42',
    ])
      expect(parseRealtimeId(bad as string | null), String(bad)).toBeNull();
  });
});

describe('realtime channel authorization (M3.1b)', () => {
  const checkins = registry.resolve(`org:${A}:event:${E}:checkins`);
  const alerts = registry.resolve(`org:${A}:alerts`);
  const seats = registry.resolve(`org:${A}:event:${E}:seats`);
  if (!checkins || !alerts || !seats) throw new Error('registry');
  const grants =
    (...perms: string[]) =>
    (p: string) =>
      perms.includes(p);

  it('members of the channel’s org with the permission are allowed; without it, denied', async () => {
    expect(await decideRealtimeAccess(checkins, { memberOrgId: A, can: grants('checkin:scan') })).toBe(
      'allow',
    );
    expect(await decideRealtimeAccess(checkins, { memberOrgId: A, can: grants('events:read') })).toBe('deny');
    expect(await decideRealtimeAccess(alerts, { memberOrgId: A, can: grants('events:read') })).toBe('allow');
    // An async permission check (event roles) works the same.
    expect(
      await decideRealtimeAccess(checkins, { memberOrgId: A, can: async (p) => p === 'checkin:scan' }),
    ).toBe('allow');
  });

  it('another org’s member is denied whatever permissions they hold', async () => {
    const all = () => true;
    expect(await decideRealtimeAccess(checkins, { memberOrgId: B, can: all })).toBe('deny');
    expect(await decideRealtimeAccess(alerts, { memberOrgId: B, can: all })).toBe('deny');
    expect(await decideRealtimeAccess(checkins, { memberOrgId: null, can: all })).toBe('deny');
  });

  it('devices only for their own org, and only on channels that take devices', async () => {
    expect(await decideRealtimeAccess(checkins, { deviceOrgId: A })).toBe('allow');
    expect(await decideRealtimeAccess(checkins, { deviceOrgId: B })).toBe('deny');
    expect(await decideRealtimeAccess(alerts, { deviceOrgId: A })).toBe('deny');
    // A device never borrows a member's rights.
    expect(await decideRealtimeAccess(alerts, { deviceOrgId: A, memberOrgId: A, can: () => true })).toBe(
      'deny',
    );
  });

  it('public channels admit anyone as the public (the app then runs the public check)', async () => {
    expect(await decideRealtimeAccess(seats, {})).toBe('public');
    expect(await decideRealtimeAccess(seats, { memberOrgId: B, can: () => true })).toBe('public');
    expect(await decideRealtimeAccess(seats, { deviceOrgId: B })).toBe('public');
    expect(await decideRealtimeAccess(checkins, {})).toBe('deny');
  });
});

describe('Ably token auth (M3.1b, never calls Ably)', () => {
  const key = 'app1.key1:s3cr3t';
  const channel = realtimeChannelName(CHECKINS_CHANNEL, A, E);

  it('signs a TokenRequest for exactly the listed channels, subscribe only', () => {
    const t = ablyTokenRequest({
      apiKey: key,
      channels: [channel],
      clientId: 'c1',
      ttlMs: 600_000,
      now: 1_700_000_000_000,
      nonce: 'n1',
    });
    expect(t.keyName).toBe('app1.key1');
    expect(JSON.parse(t.capability)).toEqual({ [channel]: ['subscribe'] });
    const expected = createHmac('sha256', 's3cr3t')
      .update(`app1.key1\n600000\n${t.capability}\nc1\n1700000000000\nn1\n`)
      .digest('base64');
    expect(t.mac).toBe(expected);
    expect(JSON.stringify(t)).not.toContain('s3cr3t');
  });

  it('refuses malformed keys and channels outside an org; clamps the ttl', () => {
    expect(() => ablyTokenRequest({ apiKey: 'nocolon', channels: [channel] })).toThrow(/ABLY_API_KEY/);
    expect(() => ablyTokenRequest({ apiKey: key, channels: ['public:everything'] })).toThrow(/channel/);
    expect(() => ablyTokenRequest({ apiKey: key, channels: ['*'] })).toThrow(/channel/);
    expect(ablyTokenRequest({ apiKey: key, channels: [channel], ttlMs: 1 }).ttl).toBe(60_000);
    expect(ablyTokenRequest({ apiKey: key, channels: [channel], ttlMs: 1e12 }).ttl).toBe(86_400_000);
    const a = ablyTokenRequest({ apiKey: key, channels: [channel] });
    const b = ablyTokenRequest({ apiKey: key, channels: [channel] });
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('is config-switched: SSE unless REALTIME_PROVIDER=ably with a key; CSP widens only then', () => {
    expect(realtimeProvider({})).toBe('sse');
    expect(realtimeProvider({ REALTIME_PROVIDER: 'ably' })).toBe('sse');
    expect(realtimeProvider({ REALTIME_PROVIDER: 'ably', ABLY_API_KEY: key })).toBe('ably');
    expect(realtimeConnectSources({})).toEqual([]);
    expect(realtimeConnectSources({ REALTIME_PROVIDER: 'ably' })).toEqual([]);
    expect(realtimeConnectSources({ REALTIME_PROVIDER: 'ably', ABLY_API_KEY: key })).toEqual([
      ...ABLY_CONNECT_SOURCES,
    ]);
  });
});
