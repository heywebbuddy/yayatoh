import { describe, expect, it } from 'vitest';
import {
  availableSessions,
  conflictsWith,
  type EnrollTarget,
  enrollDecision,
  type LineEntry,
  offerExpiry,
  PROMOTION_CLOSE_MS,
  planPromotion,
  promotionClosesAt,
  promotionOpen,
  roomLeft,
  type SessionSlot,
  type SkipReason,
  slotsOverlap,
} from '../src/domain/enrollment.ts';

const H = 3_600_000;
const T0 = new Date('2030-05-01T14:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * H);
const slot = (id: string, h: number, len = 1, extra: Partial<SessionSlot> = {}): SessionSlot => ({
  sessionId: id,
  startsAt: at(h),
  endsAt: at(h + len),
  capacity: 10,
  groupId: null,
  ...extra,
});
const target = (s: SessionSlot, extra: Partial<EnrollTarget> = {}): EnrollTarget => ({
  ...s,
  admission: 'optional',
  enrollmentOpen: true,
  enrolled: 0,
  ...extra,
});
const NOW = at(-72);

describe('promotion close time (P5-9)', () => {
  it('stops promoting 24 h before the start, exactly', () => {
    const start = at(0);
    expect(PROMOTION_CLOSE_MS).toBe(24 * H);
    expect(promotionClosesAt(start)).toEqual(at(-24));
    expect(promotionOpen(start, at(-24.001))).toBe(true);
    expect(promotionOpen(start, at(-24))).toBe(false);
    expect(promotionOpen(start, at(-1))).toBe(false);
  });

  it('an offer lasts its window but never past the close time', () => {
    expect(offerExpiry(at(-72), 240, at(0))).toEqual(at(-68));
    expect(offerExpiry(at(-25), 240, at(0))).toEqual(at(-24));
  });
});

describe('availability by admission item', () => {
  const all = ['a', 'b', 'c'];
  it('an admission item listing nothing gives every session; a listing gives only those', () => {
    expect([...availableSessions([{ kind: 'admission', sessionIds: [] }], all)]).toEqual(all);
    expect([...availableSessions([{ kind: 'admission', sessionIds: ['b'] }], all)]).toEqual(['b']);
  });
  it('an add-on gives only what it lists (nothing by default); items add up', () => {
    expect([...availableSessions([{ kind: 'add_on', sessionIds: [] }], all)]).toEqual([]);
    const day = { kind: 'admission' as const, sessionIds: ['a'] };
    const workshop = { kind: 'add_on' as const, sessionIds: ['c', 'gone'] };
    expect([...availableSessions([day, workshop], all)].sort()).toEqual(['a', 'c']);
  });
});

describe('conflicts', () => {
  it('half-open intervals: back-to-back sessions do not overlap', () => {
    expect(slotsOverlap(slot('a', 0), slot('b', 1))).toBe(false);
    expect(slotsOverlap(slot('a', 0, 2), slot('b', 1))).toBe(true);
  });
  it('names the held session of the same group apart from plain overlaps', () => {
    const t = slot('t', 0, 1, { groupId: 'g' });
    const c = conflictsWith(t, [slot('g2', 0, 1, { groupId: 'g' }), slot('o', 0.5), slot('far', 5)]);
    expect(c.group?.sessionId).toBe('g2');
    expect(c.overlap.map((o) => o.sessionId)).toEqual(['o']);
  });
});

describe('enrollDecision', () => {
  const base = { available: true, held: [] as SessionSlot[], now: NOW, choice: 'refuse' as const };
  it('enrols in an open optional session with room', () => {
    expect(enrollDecision({ ...base, target: target(slot('t', 0)) })).toEqual({ kind: 'enrol', replace: [] });
  });
  it('refuses what is not given, included, closed or started', () => {
    const t = target(slot('t', 0));
    expect(enrollDecision({ ...base, target: t, available: false })).toMatchObject({
      reason: 'not_available',
    });
    expect(enrollDecision({ ...base, target: { ...t, admission: 'included' } })).toMatchObject({
      reason: 'included',
    });
    expect(enrollDecision({ ...base, target: { ...t, enrollmentOpen: false } })).toMatchObject({
      reason: 'closed',
    });
    expect(enrollDecision({ ...base, target: t, now: at(0) })).toMatchObject({ reason: 'started' });
  });
  it('a session group allows exactly one pick: a second is refused, or replaces the first', () => {
    const t = target(slot('t', 0, 1, { groupId: 'g' }));
    const held = [slot('other', 0, 1, { groupId: 'g' })];
    expect(enrollDecision({ ...base, target: t, held })).toEqual({
      kind: 'refuse',
      reason: 'one_per_group',
      withSessionId: 'other',
    });
    expect(enrollDecision({ ...base, target: t, held, choice: 'replace' })).toEqual({
      kind: 'enrol',
      replace: ['other'],
    });
    // Keeping both is never possible inside a group.
    expect(enrollDecision({ ...base, target: t, held, choice: 'keep_both' })).toMatchObject({
      reason: 'one_per_group',
    });
  });
  it('overlaps are refused with the session in the way; replace drops it; keep both only uncapped', () => {
    const t = target(slot('t', 0));
    const held = [slot('o', 0.5)];
    expect(enrollDecision({ ...base, target: t, held })).toEqual({
      kind: 'refuse',
      reason: 'overlap',
      withSessionId: 'o',
    });
    expect(enrollDecision({ ...base, target: t, held, choice: 'replace' })).toEqual({
      kind: 'enrol',
      replace: ['o'],
    });
    expect(enrollDecision({ ...base, target: t, held, choice: 'keep_both' })).toMatchObject({
      reason: 'keep_both_capped',
    });
    const uncapped = target(slot('t', 0, 1, { capacity: null }));
    expect(
      enrollDecision({
        ...base,
        target: uncapped,
        held: [slot('o', 0.5, 1, { capacity: null })],
        choice: 'keep_both',
      }),
    ).toEqual({ kind: 'enrol', replace: [] });
    expect(
      enrollDecision({ ...base, target: uncapped, held: [slot('o', 0.5)], choice: 'keep_both' }),
    ).toMatchObject({ reason: 'keep_both_capped', withSessionId: 'o' });
  });
  it('a full session offers its line until the close, and only without a conflict', () => {
    const full = target(slot('t', 0, 1, { capacity: 2 }), { enrolled: 2 });
    expect(enrollDecision({ ...base, target: full })).toEqual({ kind: 'waitlist' });
    expect(enrollDecision({ ...base, target: full, now: at(-23) })).toMatchObject({
      reason: 'waitlist_closed',
    });
    expect(enrollDecision({ ...base, target: full, held: [slot('o', 0)], choice: 'replace' })).toMatchObject({
      reason: 'overlap',
    });
    expect(roomLeft({ capacity: 2, enrolled: 2 })).toBe(0);
    expect(roomLeft({ capacity: null, enrolled: 9 })).toBeNull();
  });
});

/* ------------------------------------------------- property: promotion never loops ---- */

/** A small seeded PRNG (mulberry32): the same seed always gives the same run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Person extends LineEntry {
  status: 'waiting' | 'enrolled' | 'skipped' | 'dropped' | 'left';
  /** Whether the re-check would pass them over now (changes as they enrol elsewhere). */
  blocked: SkipReason | null;
  order: number;
}

describe('waitlist promotion never loops (property, 400 seeded runs)', () => {
  it('fills at most the free places, in line order, visits each person once, and reaches a fixpoint', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rand = rng(seed);
      const capacity = 1 + Math.floor(rand() * 6);
      const people: Person[] = [];
      let next = 0;
      let open = true;
      let totalSteps = 0;
      const enrolled = () => people.filter((p) => p.status === 'enrolled').length;
      const line = () =>
        people.filter((p) => p.status === 'waiting').sort((x, y) => x.order - y.order) as Person[];
      const promote = () => {
        const before = line();
        const steps = planPromotion({
          room: capacity - enrolled(),
          open,
          line: before,
          check: (p) => p.blocked,
        });
        // Each person at most once, in line order, never more promotions than free places.
        const ids = steps.map((s) => s.entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        const positions = steps.map((s) => before.indexOf(s.entry as Person));
        expect(positions).toEqual([...positions].sort((x, y) => x - y));
        expect(steps.filter((s) => s.kind === 'promote').length).toBeLessThanOrEqual(capacity - enrolled());
        if (!open) expect(steps).toEqual([]);
        for (const s of steps) {
          const p = s.entry as Person;
          if (s.kind === 'skip') {
            expect(p.blocked).not.toBeNull();
            p.status = 'skipped';
          } else {
            expect(p.blocked).toBeNull();
            p.status = 'enrolled';
          }
        }
        totalSteps += steps.length;
        // Nobody who fits waits behind a promoted person while places were left.
        return steps.length;
      };
      for (let op = 0; op < 60; op++) {
        const r = rand();
        if (r < 0.4) {
          people.push({
            id: `p${next}`,
            order: next++,
            status: enrolled() < capacity && line().length === 0 ? 'enrolled' : 'waiting',
            blocked: rand() < 0.25 ? (rand() < 0.5 ? 'overlap' : 'one_per_group') : null,
          });
        } else if (r < 0.65) {
          const e = people.filter((p) => p.status === 'enrolled');
          const p = e[Math.floor(rand() * e.length)];
          if (p) p.status = 'dropped';
        } else if (r < 0.75) {
          const w = line();
          const p = w[Math.floor(rand() * w.length)];
          if (p) p.blocked = p.blocked ? null : 'overlap';
        } else if (r < 0.8) {
          const w = line();
          const p = w[Math.floor(rand() * w.length)];
          if (p) p.status = 'left';
        } else if (r < 0.83) {
          open = false;
        }
        promote();
        // Fixpoint: promoting again at once changes nothing (no loop between promotions).
        expect(promote()).toBe(0);
        expect(enrolled()).toBeLessThanOrEqual(capacity);
        // While the line promotes, a free place and a fitting first person never coexist.
        const head = line()[0];
        if (open && head && enrolled() < capacity) expect(head.blocked).not.toBeNull();
      }
      // Every step ends one wait: the total work is bounded by the people who ever joined.
      expect(totalSteps).toBeLessThanOrEqual(people.length);
    }
  });
});
