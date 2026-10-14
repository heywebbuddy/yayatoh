import { memoryKeyValueStore } from '@yayatoh/mobile-core';
import {
  clockOffsetMs,
  createDeviceSession,
  DEVICE_KEY,
  type DeviceSession,
  ENDED_KEY,
  EVENT_WINDOW,
  HEARTBEAT_MS,
  insideEventWindow,
  type WipeReason,
} from '../src/device/session';
import {
  CHECKPOINTS,
  createFakeDoor,
  DEVICE_ID,
  EVENT_ID,
  enrolLink,
  type FakeDoor,
  OTHER_TOKEN,
  TOKEN,
} from './helpers/fake-door';

const API = 'https://app.yayatoh.com/api/v1';
const identity = { app: 'staff', platform: 'ios', version: '1.2.3', build: '45' } as const;

interface Rig {
  door: FakeDoor;
  storage: ReturnType<typeof memoryKeyValueStore>;
  session: DeviceSession;
  logs: string[];
  upgrades: unknown[];
  clock: { now: number };
  tick(): Promise<void>;
  timer: { active: boolean; ms: number | null };
  battery: { level: number | null };
  make(): DeviceSession;
}

function rig(opts: { storage?: ReturnType<typeof memoryKeyValueStore> } = {}): Rig {
  const clock = { now: Date.parse('2026-10-14T12:00:00Z') };
  const door = createFakeDoor(() => clock.now);
  const storage = opts.storage ?? memoryKeyValueStore();
  const logs: string[] = [];
  const upgrades: unknown[] = [];
  const battery = { level: 80 as number | null };
  let callback: (() => void) | null = null;
  const timer = { active: false, ms: null as number | null };
  const make = () =>
    createDeviceSession({
      storage,
      apiBaseUrl: API,
      identity,
      fetch: door.fetch,
      now: () => clock.now,
      battery: async () => battery.level,
      log: (m) => logs.push(m),
      onUpgradeRequired: (i) => upgrades.push(i),
      timers: {
        setInterval: (cb, ms) => {
          callback = cb;
          timer.active = true;
          timer.ms = ms;
          return 1;
        },
        clearInterval: () => {
          timer.active = false;
          callback = null;
        },
      },
    });
  const r: Rig = {
    door,
    storage,
    session: make(),
    logs,
    upgrades,
    clock,
    timer,
    battery,
    make,
    tick: async () => {
      callback?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
  return r;
}

const heartbeats = (door: FakeDoor) => door.calls.filter((c) => c.url.endsWith('/devices/heartbeat'));

async function enrolled(r: Rig) {
  const out = await r.session.enrol(enrolLink());
  expect(out).toEqual({ kind: 'enrolled' });
  // Enrolling sends a first heartbeat so the device board shows it at once; let it finish.
  await r.session.heartbeat();
  return r;
}

describe('restoring', () => {
  it('starts unenrolled when nothing is stored', async () => {
    const r = rig();
    expect(r.session.state.loaded).toBe(false);
    await r.session.restore();
    expect(r.session.state).toMatchObject({
      loaded: true,
      status: 'unenrolled',
      token: null,
      deviceId: null,
    });
  });

  it('comes back enrolled from secure storage after a restart', async () => {
    const first = await enrolled(rig());
    const second = rig({ storage: first.storage });
    await second.session.restore();
    expect(second.session.state).toMatchObject({
      status: 'enrolled',
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      token: TOKEN,
      event: { name: 'Summit' },
    });
    expect(second.session.state.checkpoints.map((c) => c.id)).toEqual(CHECKPOINTS.map((c) => c.id));
  });

  it('treats unreadable storage as unenrolled', async () => {
    const storage = memoryKeyValueStore({ [DEVICE_KEY]: '{not json' });
    const r = rig({ storage });
    await r.session.restore();
    expect(r.session.state.status).toBe('unenrolled');
  });
});

describe('enrolling', () => {
  it('proves the key with one call, stores it in secure storage and reads the event', async () => {
    const r = rig();
    await enrolled(r);
    expect(r.session.state).toMatchObject({
      status: 'enrolled',
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      checkpointId: null,
      checkpointChosen: false,
      event: { name: 'Summit', timezone: 'Europe/Lisbon' },
    });
    expect(JSON.parse(r.storage.data.get(DEVICE_KEY) ?? '{}')).toMatchObject({
      token: TOKEN,
      eventId: EVENT_ID,
    });
    const [overview, manifest] = r.door.calls;
    expect(overview?.url).toContain(`/staff/events/${EVENT_ID}/overview`);
    expect(manifest?.url).toContain(`/events/${EVENT_ID}/manifest`);
    expect(manifest?.url).toContain('limit=1');
  });

  it('sends the key only in the Authorization header, never in a URL', async () => {
    const r = await enrolled(rig());
    await r.session.heartbeat();
    expect(r.door.calls.length).toBeGreaterThan(2);
    for (const call of r.door.calls) {
      expect(call.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
      expect(call.url).not.toContain('yyd_');
      expect(call.url).not.toContain('#');
      expect(JSON.stringify(call.body)).not.toContain(TOKEN);
    }
  });

  it('identifies the app on every call', async () => {
    const r = await enrolled(rig());
    for (const call of r.door.calls) expect(call.client).toBe('yayatoh-staff-ios/1.2.3 (45)');
  });

  it('accepts the two parts of a link as well (the /enrol route)', async () => {
    const r = rig();
    expect(await r.session.enrol({ eventId: EVENT_ID, token: TOKEN })).toEqual({ kind: 'enrolled' });
  });

  it('refuses text that is not an enrolment link without calling the server', async () => {
    const r = rig();
    expect(await r.session.enrol('hello')).toEqual({ kind: 'invalid_link' });
    expect(r.door.calls).toHaveLength(0);
    expect(r.storage.data.size).toBe(0);
  });

  it('refuses a key the server does not know and stores nothing', async () => {
    const r = rig();
    expect(await r.session.enrol(enrolLink(OTHER_TOKEN))).toEqual({ kind: 'rejected' });
    expect(r.storage.data.size).toBe(0);
    expect(r.session.state.status).toBe('unenrolled');
  });

  it('refuses an event the key is not for', async () => {
    const r = rig();
    r.door.overviewStatus = 404;
    expect(await r.session.enrol(enrolLink())).toEqual({ kind: 'wrong_event' });
    r.door.overviewStatus = 403;
    expect(await r.session.enrol(enrolLink())).toEqual({ kind: 'wrong_event' });
    expect(r.storage.data.size).toBe(0);
  });

  it('says so when there is no network, and when the server limits it', async () => {
    const r = rig();
    r.door.failNetwork = true;
    expect(await r.session.enrol(enrolLink())).toEqual({ kind: 'unavailable' });
    r.door.failNetwork = false;
    r.door.overviewStatus = 500;
    expect(await r.session.enrol(enrolLink())).toEqual({ kind: 'unavailable' });
    r.door.overviewStatus = 429;
    expect(await r.session.enrol(enrolLink())).toMatchObject({ kind: 'rateLimited' });
    expect(r.storage.data.size).toBe(0);
  });

  it('replacing an enrolment erases the old device’s local data first', async () => {
    const r = await enrolled(rig());
    const reasons: WipeReason[] = [];
    r.session.onWipe((reason) => void reasons.push(reason));
    r.door.valid.add(OTHER_TOKEN);
    expect(await r.session.enrol(enrolLink(OTHER_TOKEN))).toEqual({ kind: 'enrolled' });
    expect(reasons).toEqual(['replaced']);
    expect(r.session.state.token).toBe(OTHER_TOKEN);
  });

  it('enrolling again with the same key is not a wipe', async () => {
    const r = await enrolled(rig());
    const reasons: WipeReason[] = [];
    r.session.onWipe((reason) => void reasons.push(reason));
    await r.session.enrol(enrolLink());
    expect(reasons).toEqual([]);
    expect(r.session.state.status).toBe('enrolled');
  });

  it('keeps the enrolment when only the event details cannot be read yet', async () => {
    const r = rig();
    const original = r.door.fetch;
    r.door.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/manifest')) throw new TypeError('offline');
      return original(input, init);
    };
    const session = createDeviceSession({
      storage: r.storage,
      apiBaseUrl: API,
      identity,
      fetch: r.door.fetch,
    });
    expect(await session.enrol(enrolLink())).toEqual({ kind: 'enrolled' });
    expect(session.state).toMatchObject({ status: 'enrolled', event: null, checkpoints: [] });
    session.stopHeartbeat();
  });
});

describe('choosing a checkpoint', () => {
  it('stores the choice, and reports it with the next heartbeat', async () => {
    const r = await enrolled(rig());
    const [first] = CHECKPOINTS;
    expect(await r.session.selectCheckpoint(first?.id ?? null)).toBe(true);
    expect(r.session.state).toMatchObject({ checkpointId: first?.id, checkpointChosen: true });
    expect(JSON.parse(r.storage.data.get(DEVICE_KEY) ?? '{}').checkpointId).toBe(first?.id);
    await r.session.heartbeat();
    expect(heartbeats(r.door).at(-1)?.body).toMatchObject({ checkpointId: first?.id, eventId: EVENT_ID });
  });

  it('can choose the whole event', async () => {
    const r = await enrolled(rig());
    expect(await r.session.selectCheckpoint(null)).toBe(true);
    expect(r.session.state).toMatchObject({ checkpointId: null, checkpointChosen: true });
  });

  it('refuses a place the event does not offer', async () => {
    const r = await enrolled(rig());
    expect(await r.session.selectCheckpoint('0192f6f0-0000-7000-8000-0000000c0999')).toBe(false);
    expect(r.session.state.checkpointChosen).toBe(false);
  });

  it('does nothing when not enrolled', async () => {
    const r = rig();
    expect(await r.session.selectCheckpoint(null)).toBe(false);
  });
});

describe('the heartbeat', () => {
  it('reports battery, queue depth, clock offset, event, place and version', async () => {
    const r = await enrolled(rig());
    r.session.setQueueDepthSource(() => 7);
    r.battery.level = 63.4;
    await r.session.selectCheckpoint(CHECKPOINTS[1]?.id ?? null);
    await r.session.heartbeat();
    expect(heartbeats(r.door).at(-1)?.body).toEqual({
      batteryPct: 63,
      queueDepth: 7,
      clockOffsetMs: 0,
      eventId: EVENT_ID,
      checkpointId: CHECKPOINTS[1]?.id,
      appVersion: '1.2.3',
    });
  });

  it('reports 0 until the outbox registers, and null when the phone cannot say its battery', async () => {
    const r = await enrolled(rig());
    r.battery.level = null;
    await r.session.heartbeat();
    expect(heartbeats(r.door).at(-1)?.body).toMatchObject({ batteryPct: null, queueDepth: 0 });
  });

  it('survives a queue or battery reader that throws', async () => {
    const r = await enrolled(rig());
    r.session.setQueueDepthSource(() => {
      throw new Error('db closed');
    });
    expect(await r.session.heartbeat()).toMatchObject({ kind: 'ok' });
    expect(heartbeats(r.door).at(-1)?.body).toMatchObject({ queueDepth: 0 });
  });

  it('measures the clock offset from the server time and sends it next time', async () => {
    const r = await enrolled(rig());
    r.door.serverTimeOffsetMs = 90_000;
    await r.session.heartbeat();
    expect(r.session.clockOffsetMs).toBe(90_000);
    await r.session.heartbeat();
    expect(heartbeats(r.door).at(-1)?.body).toMatchObject({ clockOffsetMs: 90_000 });
  });

  it('does not correct a clock it cannot prove wrong', () => {
    expect(clockOffsetMs({ serverTime: 1_000, sentAt: 900, receivedAt: 1_200 })).toBe(0);
    expect(clockOffsetMs({ serverTime: 5_000, sentAt: 900, receivedAt: 1_200 })).toBe(3_800);
    expect(clockOffsetMs({ serverTime: -5_000, sentAt: 900, receivedAt: 1_200 })).toBe(-5_900);
  });

  it('beats every 30 seconds while running, and stops when told to', async () => {
    const r = await enrolled(rig());
    expect(r.timer).toMatchObject({ active: true, ms: HEARTBEAT_MS });
    expect(HEARTBEAT_MS).toBe(30_000);
    const before = heartbeats(r.door).length;
    await r.tick();
    await r.tick();
    expect(heartbeats(r.door).length).toBe(before + 2);
    r.session.stopHeartbeat();
    expect(r.timer.active).toBe(false);
  });

  it('shares one heartbeat between callers made at the same time', async () => {
    const r = await enrolled(rig());
    r.session.stopHeartbeat();
    const before = heartbeats(r.door).length;
    await Promise.all([r.session.heartbeat(), r.session.heartbeat(), r.session.heartbeat()]);
    expect(heartbeats(r.door).length).toBe(before + 1);
  });

  it('stays enrolled and keeps scanning when the network is down or the server fails', async () => {
    const r = await enrolled(rig());
    r.door.failNetwork = true;
    expect(await r.session.heartbeat()).toEqual({ kind: 'unavailable' });
    r.door.failNetwork = false;
    expect(r.session.state.status).toBe('enrolled');
    expect(r.storage.data.has(DEVICE_KEY)).toBe(true);
  });

  it('does nothing without an enrolment', async () => {
    const r = rig();
    expect(await r.session.heartbeat()).toEqual({ kind: 'idle' });
    expect(r.door.calls).toHaveLength(0);
  });

  it('moves the device when a supervisor sends it to a checkpoint, once', async () => {
    const r = await enrolled(rig());
    r.door.heartbeatExtras = {
      checkpoint: { id: CHECKPOINTS[1]?.id, requestedAt: '2026-10-14T12:00:00Z' },
    };
    expect(await r.session.heartbeat()).toMatchObject({ kind: 'ok', moved: true });
    expect(r.session.state.checkpointId).toBe(CHECKPOINTS[1]?.id);
    // The person moves it back; the same directive is not applied again.
    await r.session.selectCheckpoint(CHECKPOINTS[0]?.id ?? null);
    expect(await r.session.heartbeat()).toMatchObject({ kind: 'ok', moved: false });
    expect(r.session.state.checkpointId).toBe(CHECKPOINTS[0]?.id);
  });

  it('falls back to the whole event for a place this device cannot scan at', async () => {
    const r = await enrolled(rig());
    r.door.heartbeatExtras = { checkpoint: { id: 'not-offered', requestedAt: '2026-10-14T12:00:00Z' } };
    await r.session.heartbeat();
    expect(r.session.state).toMatchObject({ checkpointId: null, checkpointChosen: true });
  });

  it('runs the sync callbacks when a supervisor asks for a sync, once', async () => {
    const r = await enrolled(rig());
    let syncs = 0;
    r.session.onSyncRequested(() => void syncs++);
    r.door.heartbeatExtras = { syncRequestedAt: '2026-10-14T12:00:00Z' };
    await r.session.heartbeat();
    await r.session.heartbeat();
    expect(syncs).toBe(1);
  });
});

describe('revoked and wiped devices', () => {
  it('a revoked device (401 on the heartbeat) erases its token and data and returns to enrolment', async () => {
    const r = await enrolled(rig());
    const reasons: WipeReason[] = [];
    r.session.onWipe((reason) => void reasons.push(reason));
    r.door.valid.delete(TOKEN);
    expect(await r.session.heartbeat()).toEqual({ kind: 'ended', reason: 'revoked' });
    expect(r.session.state).toMatchObject({ status: 'revoked', token: null, eventId: null, deviceId: null });
    expect(r.storage.data.has(DEVICE_KEY)).toBe(false);
    expect(reasons).toEqual(['revoked']);
    expect(JSON.parse(r.storage.data.get(ENDED_KEY) ?? '{}')).toEqual({ status: 'revoked', wipeDone: true });
    expect(r.timer.active).toBe(false);
  });

  it('a wiped device (the wipe command) erases its token and data within that heartbeat', async () => {
    const r = await enrolled(rig());
    const reasons: WipeReason[] = [];
    r.session.onWipe((reason) => void reasons.push(reason));
    r.door.wiping.add(TOKEN);
    expect(await r.session.heartbeat()).toEqual({ kind: 'ended', reason: 'wiped' });
    expect(r.session.state).toMatchObject({ status: 'wiped', token: null });
    expect(r.storage.data.has(DEVICE_KEY)).toBe(false);
    expect(reasons).toEqual(['wiped']);
  });

  it('is wiped within one heartbeat of the timer, with no other call needed', async () => {
    const r = await enrolled(rig());
    const wiped = jest.fn();
    r.session.onWipe(wiped);
    r.door.wiping.add(TOKEN);
    await r.tick();
    expect(wiped).toHaveBeenCalledTimes(1);
    expect(r.session.state.status).toBe('wiped');
  });

  it('a 401 on any other device call asks the heartbeat, so a wiped device never lingers', async () => {
    const r = await enrolled(rig());
    const wiped = jest.fn();
    r.session.onWipe(wiped);
    r.door.wiping.add(TOKEN);
    const { response } = await r.session.api.GET('/v1/staff/events/{eventId}/overview', {
      params: { path: { eventId: EVENT_ID } },
    });
    expect(response.status).toBe(401);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(wiped).toHaveBeenCalledWith('wiped');
    expect(r.session.state.status).toBe('wiped');
  });

  it('every wipe callback runs even when one fails, and none gets the token', async () => {
    const r = await enrolled(rig());
    const ran: string[] = [];
    r.session.onWipe(() => {
      throw new Error(`boom ${TOKEN}`);
    });
    r.session.onWipe(async () => void ran.push('manifest'));
    r.session.onWipe(() => void ran.push('outbox'));
    r.door.valid.delete(TOKEN);
    await r.session.heartbeat();
    expect(ran.sort()).toEqual(['manifest', 'outbox']);
    expect(r.logs.join('\n')).not.toContain(TOKEN);
  });

  it('shows why after a restart, until the person enrols again', async () => {
    const r = await enrolled(rig());
    r.door.valid.delete(TOKEN);
    await r.session.heartbeat();
    const again = rig({ storage: r.storage });
    await again.session.restore();
    expect(again.session.state.status).toBe('revoked');
    await again.session.acknowledgeEnded();
    expect(again.session.state.status).toBe('unenrolled');
    const third = rig({ storage: r.storage });
    await third.session.restore();
    expect(third.session.state.status).toBe('unenrolled');
  });

  it('finishes a wipe that the app was closed in the middle of', async () => {
    const storage = memoryKeyValueStore({
      [ENDED_KEY]: JSON.stringify({ status: 'wiped', wipeDone: false }),
    });
    const r = rig({ storage });
    await r.session.restore();
    expect(r.session.state.status).toBe('wiped');
    const wiped = jest.fn();
    r.session.onWipe(wiped);
    await new Promise((resolve) => setImmediate(resolve));
    expect(wiped).toHaveBeenCalledWith('wiped');
  });

  it('enrolling again after a revoke starts a fresh enrolment', async () => {
    const r = await enrolled(rig());
    r.door.valid.delete(TOKEN);
    await r.session.heartbeat();
    r.door.valid.add(OTHER_TOKEN);
    expect(await r.session.enrol(enrolLink(OTHER_TOKEN))).toEqual({ kind: 'enrolled' });
    expect(r.session.state).toMatchObject({ status: 'enrolled', token: OTHER_TOKEN });
    expect(r.storage.data.has(ENDED_KEY)).toBe(false);
  });

  it('forgetting the device erases the token and the data', async () => {
    const r = await enrolled(rig());
    const reasons: WipeReason[] = [];
    r.session.onWipe((reason) => void reasons.push(reason));
    await r.session.forget();
    expect(r.session.state).toMatchObject({ status: 'unenrolled', token: null });
    expect(r.storage.data.size).toBe(0);
    expect(reasons).toEqual(['forgotten']);
    expect(r.timer.active).toBe(false);
  });

  it('a heartbeat answered after the device was removed does not bring it back', async () => {
    const r = await enrolled(rig());
    r.session.stopHeartbeat();
    const pending = r.session.heartbeat();
    await r.session.forget();
    expect(await pending).toEqual({ kind: 'idle' });
    expect(r.session.state.status).toBe('unenrolled');
  });
});

describe('the event window', () => {
  const HOUR = 3_600_000;
  const event = {
    startsAt: '2026-10-14T18:00:00Z',
    endsAt: '2026-10-14T22:00:00Z',
  };
  const at = (iso: string) => Date.parse(iso);

  it('runs from 24 hours before the start to 2 hours after the end', () => {
    expect(EVENT_WINDOW).toEqual({ beforeMs: 24 * HOUR, afterMs: 2 * HOUR });
    expect(insideEventWindow(event, at('2026-10-13T18:00:00Z'))).toBe(true);
    expect(insideEventWindow(event, at('2026-10-13T17:59:59Z'))).toBe(false);
    expect(insideEventWindow(event, at('2026-10-14T20:00:00Z'))).toBe(true);
    expect(insideEventWindow(event, at('2026-10-15T00:00:00Z'))).toBe(true);
    expect(insideEventWindow(event, at('2026-10-15T00:00:01Z'))).toBe(false);
  });

  it('is never inside for a missing or unreadable window', () => {
    expect(insideEventWindow(null, 0)).toBe(false);
    expect(insideEventWindow({ startsAt: 'x', endsAt: 'y' }, 0)).toBe(false);
  });

  it('is true for an enrolled device inside its event, and false well outside it', async () => {
    const r = rig();
    r.door.startsAt = new Date(r.clock.now + 2 * HOUR).toISOString();
    r.door.endsAt = new Date(r.clock.now + 6 * HOUR).toISOString();
    await enrolled(r);
    expect(await r.session.insideEventWindow()).toBe(true);
    r.clock.now += 6 * HOUR + 2 * HOUR + 1;
    expect(await r.session.insideEventWindow()).toBe(false);
  });

  it('is false for an event days away', async () => {
    const r = rig();
    r.door.startsAt = new Date(r.clock.now + 72 * HOUR).toISOString();
    r.door.endsAt = new Date(r.clock.now + 80 * HOUR).toISOString();
    await enrolled(r);
    expect(await r.session.insideEventWindow()).toBe(false);
  });

  it('is true for an enrolled device whose dates are not known yet, false when unenrolled', async () => {
    const r = rig();
    expect(await r.session.insideEventWindow()).toBe(false);
    const storage = memoryKeyValueStore({
      [DEVICE_KEY]: JSON.stringify({
        token: TOKEN,
        eventId: EVENT_ID,
        deviceId: DEVICE_ID,
        checkpointId: null,
        checkpointChosen: false,
        event: null,
        checkpoints: [],
      }),
    });
    const noDates = rig({ storage });
    expect(await noDates.session.insideEventWindow()).toBe(true);
  });
});

describe('the version gate', () => {
  it('hears a 426 on a device call, so the gate can decide whether to show it', async () => {
    const r = await enrolled(rig());
    r.door.upgradeRequired = true;
    await r.session.api.GET('/v1/staff/events/{eventId}/overview', {
      params: { path: { eventId: EVENT_ID } },
    });
    expect(r.upgrades).toEqual([
      { minimumVersion: '9.0.0', latestVersion: '9.1.0', storeUrl: 'https://store.example/staff' },
    ]);
  });
});

describe('privacy: the enrolment key never reaches a log', () => {
  it('stays out of every log line through enrolment, refusals, heartbeats and a wipe', async () => {
    const r = rig();
    await r.session.enrol(enrolLink(OTHER_TOKEN));
    r.door.failNetwork = true;
    await r.session.enrol(enrolLink());
    r.door.failNetwork = false;
    await enrolled(r);
    r.session.setQueueDepthSource(() => {
      throw new Error('x');
    });
    await r.session.heartbeat();
    r.door.valid.delete(TOKEN);
    await r.session.heartbeat();
    const all = r.logs.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(OTHER_TOKEN);
    expect(all).not.toContain(EVENT_ID);
    expect(all).not.toContain('yyd_');
  });

  it('stays out of the state of a device that has been wiped', async () => {
    const r = await enrolled(rig());
    r.door.valid.delete(TOKEN);
    await r.session.heartbeat();
    expect(JSON.stringify(r.session.state)).not.toContain(TOKEN);
    expect(JSON.stringify([...r.storage.data.values()])).not.toContain(TOKEN);
  });
});
