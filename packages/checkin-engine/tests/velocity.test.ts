import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VELOCITY_RULES,
  detectVelocity,
  distanceMeters,
  type GeoPoint,
  outcomeOf,
  type VelocityRules,
  type VelocityScan,
} from '../src/index.ts';

const T0 = Date.parse('2027-12-01T20:00:00Z');
const rules: VelocityRules = {
  maxScansPerMinute: 5,
  maxTravelKmh: 12,
  rejectedBurst: { count: 4, windowMs: 60_000 },
};
let n = 0;
const scan = (at: number, over: Partial<VelocityScan> = {}): VelocityScan => ({
  id: `s${String(++n).padStart(4, '0')}`,
  at,
  source: 'device:a',
  ticketId: null,
  checkpointId: null,
  outcome: 'ok',
  ...over,
});
/** `count` scans, `everyMs` apart, starting at `from`. */
const series = (count: number, everyMs: number, from = T0, over: Partial<VelocityScan> = {}) =>
  Array.from({ length: count }, (_, i) => scan(from + i * everyMs, over));

// Two gates of a stadium ~700 m apart, and a door 20 m from the first.
const places = new Map<string, GeoPoint>([
  ['north', { latitude: 41.8623, longitude: -87.6167 }],
  ['south', { latitude: 41.856, longitude: -87.6167 }],
  ['north-side', { latitude: 41.86248, longitude: -87.6167 }],
]);

describe('device scan rate', () => {
  it('more than the limit in any 60 s raises one device_velocity at the scan that crossed it', () => {
    const f = detectVelocity(series(6, 5_000), places, rules);
    expect(f).toEqual([
      { kind: 'device_velocity', source: 'device:a', at: T0 + 25_000, count: 6, windowSeconds: 60 },
    ]);
  });

  it('exactly the limit, or the same count spread over more than a minute, is a human', () => {
    expect(detectVelocity(series(5, 1_000), places, rules)).toEqual([]);
    expect(detectVelocity(series(12, 13_000), places, rules)).toEqual([]);
  });

  it('a sustained burst is one signal per window, not one per scan', () => {
    const f = detectVelocity(series(40, 2_000), places, rules).filter((x) => x.kind === 'device_velocity');
    // 80 s of scanning at 30/min: the first crossing, then again once a full window has passed.
    expect(f.map((x) => x.at - T0)).toEqual([10_000, 70_000]);
  });

  it('devices are judged separately, and input order does not matter', () => {
    const mixed = [...series(4, 1_000), ...series(4, 1_000, T0 + 500, { source: 'device:b' })].reverse();
    expect(detectVelocity(mixed, places, rules)).toEqual([]);
    expect(detectVelocity(series(6, 1_000), places, DEFAULT_VELOCITY_RULES)).toEqual([]);
  });
});

describe('refused bursts', () => {
  it('the Nth refusal in the window raises one rejected_burst; successes in between do not reset it', () => {
    const log = [
      ...series(3, 5_000, T0, { outcome: 'refused' }),
      scan(T0 + 16_000),
      scan(T0 + 20_000, { outcome: 'refused' }),
      scan(T0 + 21_000, { outcome: 'refused' }),
    ];
    expect(detectVelocity(log, places, { ...rules, maxScansPerMinute: 40 })).toEqual([
      { kind: 'rejected_burst', source: 'device:a', at: T0 + 20_000, count: 4, windowSeconds: 60 },
    ]);
  });

  it('refusals spread past the window are not a burst', () => {
    expect(detectVelocity(series(6, 30_000, T0, { outcome: 'refused' }), places, rules)).toEqual([]);
    expect(outcomeOf('admitted')).toBe('ok');
    expect(outcomeOf('granted')).toBe('ok');
    expect(outcomeOf('wrong_checkpoint')).toBe('refused');
    expect(outcomeOf('duplicate')).toBe('refused');
  });
});

describe('impossible travel', () => {
  const at = (ms: number, checkpointId: string, over: Partial<VelocityScan> = {}) =>
    scan(T0 + ms, { ticketId: 't1', checkpointId, source: `device:${checkpointId}`, ...over });

  it('distances are great-circle metres', () => {
    const d = distanceMeters(places.get('north') as GeoPoint, places.get('south') as GeoPoint);
    expect(d).toBeGreaterThan(690);
    expect(d).toBeLessThan(710);
  });

  it('the same ticket let in 700 m away 60 s later is impossible (42 km/h); 10 minutes later is fine', () => {
    const f = detectVelocity([at(0, 'north'), at(60_000, 'south')], places, rules);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: 'impossible_travel',
      ticketId: 't1',
      fromCheckpointId: 'north',
      toCheckpointId: 'south',
      seconds: 60,
      at: T0 + 60_000,
    });
    expect((f[0] as { kmh: number }).kmh).toBeGreaterThan(40);
    expect(detectVelocity([at(0, 'north'), at(600_000, 'south')], places, rules)).toEqual([]);
  });

  it('simultaneous scans far apart count; nearby doors, same checkpoint, refusals and old pairs do not', () => {
    expect(detectVelocity([at(0, 'north'), at(0, 'south')], places, rules)).toHaveLength(1);
    expect(detectVelocity([at(0, 'north'), at(1_000, 'north-side')], places, rules)).toEqual([]);
    expect(detectVelocity([at(0, 'north'), at(1_000, 'north')], places, rules)).toEqual([]);
    expect(
      detectVelocity([at(0, 'north'), at(60_000, 'south', { outcome: 'refused' })], places, rules),
    ).toEqual([]);
    expect(detectVelocity([at(0, 'north'), at(31 * 60_000, 'south')], places, rules)).toEqual([]);
  });

  it('checkpoints without a location, and scans without a ticket, are skipped', () => {
    expect(detectVelocity([at(0, 'north'), at(1_000, 'nowhere')], places, rules)).toEqual([]);
    expect(
      detectVelocity(
        [at(0, 'north', { ticketId: null }), at(1_000, 'south', { ticketId: null })],
        places,
        rules,
      ),
    ).toEqual([]);
  });

  it('re-running over the same log finds the same things (idempotent sync)', () => {
    const log = [at(0, 'north'), at(30_000, 'south'), ...series(7, 1_000)];
    expect(detectVelocity(log, places, rules)).toEqual(detectVelocity([...log].reverse(), places, rules));
  });
});
