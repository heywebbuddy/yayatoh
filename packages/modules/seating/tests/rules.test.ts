import { describe, expect, it } from 'vitest';
import {
  activeAdaRule,
  adaReleaseAt,
  blockingHits,
  evaluateSeatRules,
  type SeatingRule,
} from '../src/domain/rules.ts';

const startsAt = new Date('2028-06-10T18:00:00Z');
const ada = (severity: 'warn' | 'enforce', releaseDays = 7): SeatingRule => ({
  kind: 'ada_reserved',
  severity,
  params: { releaseDays },
});
const cap = (severity: 'warn' | 'enforce', max = 4): SeatingRule => ({
  kind: 'max_per_order_seats',
  severity,
  params: { max },
});
const seats = (n: number, accessible: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({ seatUuid: `s${i}`, accessible: accessible.includes(i) }));
const early = new Date('2028-05-01T12:00:00Z');
const late = new Date('2028-06-05T12:00:00Z');

describe('seating rules (M1.7f, D18: warn by default)', () => {
  it('accessible seats are kept back until N days before the event', () => {
    expect(adaReleaseAt(7, startsAt).toISOString()).toBe('2028-06-03T18:00:00.000Z');
    expect(adaReleaseAt(0, startsAt)).toEqual(startsAt);
    expect(activeAdaRule([ada('warn')], startsAt, early)).toEqual({
      severity: 'warn',
      releaseAt: new Date('2028-06-03T18:00:00Z'),
    });
    // At the release instant and after, nothing is kept back.
    expect(activeAdaRule([ada('warn')], startsAt, new Date('2028-06-03T18:00:00Z'))).toBeNull();
    expect(activeAdaRule([ada('enforce')], startsAt, late)).toBeNull();
    expect(activeAdaRule([cap('warn')], startsAt, early)).toBeNull();
  });

  it('an accessible seat chosen while kept back is a hit (warn or enforce), listing only those seats', () => {
    const hits = evaluateSeatRules([ada('warn')], {
      context: 'checkout',
      seats: seats(3, [1]),
      startsAt,
      now: early,
    });
    expect(hits).toEqual([
      { rule: 'ada_reserved', severity: 'warn', seats: ['s1'], releaseAt: new Date('2028-06-03T18:00:00Z') },
    ]);
    expect(
      evaluateSeatRules([ada('warn')], { context: 'checkout', seats: seats(3), startsAt, now: early }),
    ).toEqual([]);
    expect(
      evaluateSeatRules([ada('enforce')], { context: 'checkout', seats: seats(3, [0]), startsAt, now: late }),
    ).toEqual([]);
  });

  it('seats per order: over the cap is a hit at checkout and the box office, never when seating guests', () => {
    const r = [cap('enforce', 2)];
    expect(evaluateSeatRules(r, { context: 'checkout', seats: seats(2), startsAt, now: early })).toEqual([]);
    expect(evaluateSeatRules(r, { context: 'checkout', seats: seats(3), startsAt, now: early })).toEqual([
      { rule: 'max_per_order_seats', severity: 'enforce', max: 2, count: 3 },
    ]);
    expect(
      evaluateSeatRules(r, { context: 'box_office', seats: seats(3), startsAt, now: early }),
    ).toHaveLength(1);
    expect(evaluateSeatRules(r, { context: 'assign', seats: seats(9), startsAt, now: early })).toEqual([]);
    // The same seat twice counts once.
    expect(
      evaluateSeatRules(r, {
        context: 'checkout',
        seats: [...seats(2), { seatUuid: 's0', accessible: false }],
        startsAt,
        now: early,
      }),
    ).toEqual([]);
  });

  it('both rules at once', () => {
    const hits = evaluateSeatRules([ada('warn'), cap('enforce', 1)], {
      context: 'checkout',
      seats: seats(2, [0]),
      startsAt,
      now: early,
    });
    expect(hits.map((h) => [h.rule, h.severity])).toEqual([
      ['ada_reserved', 'warn'],
      ['max_per_order_seats', 'enforce'],
    ]);
  });

  it('only enforced hits block; staff may override them, buyers online never', () => {
    const hits = evaluateSeatRules([ada('enforce'), cap('warn', 1)], {
      context: 'box_office',
      seats: seats(2, [0]),
      startsAt,
      now: early,
    });
    expect(blockingHits(hits, { context: 'box_office', override: false }).map((h) => h.rule)).toEqual([
      'ada_reserved',
    ]);
    expect(blockingHits(hits, { context: 'box_office', override: true })).toEqual([]);
    expect(blockingHits(hits, { context: 'assign', override: true })).toEqual([]);
    expect(blockingHits(hits, { context: 'checkout', override: true }).map((h) => h.rule)).toEqual([
      'ada_reserved',
    ]);
    expect(
      blockingHits(
        evaluateSeatRules([ada('warn')], { context: 'checkout', seats: seats(1, [0]), startsAt, now: early }),
        { context: 'checkout', override: false },
      ),
    ).toEqual([]);
  });
});

describe('companion seats and the accessible-seat statement (M6.11a)', () => {
  const companion = (severity: 'warn' | 'enforce', maxPerAccessible = 1): SeatingRule => ({
    kind: 'ada_companion',
    severity,
    params: { maxPerAccessible },
  });
  const pick = (spec: string) =>
    [...spec].map((c, i) => ({ seatUuid: `s${i}`, accessible: c === 'A', companion: c === 'C' }));
  const evaluate = (rules: SeatingRule[], spec: string, more: { now?: Date; accessibleNeed?: boolean } = {}) =>
    evaluateSeatRules(rules, {
      context: 'checkout',
      seats: pick(spec),
      startsAt,
      now: more.now ?? early,
      ...(more.accessibleNeed ? { accessibleNeed: true } : {}),
    });

  it('a companion seat needs an accessible seat in the same order', () => {
    expect(evaluate([companion('enforce')], 'C.')).toEqual([
      { rule: 'ada_companion', severity: 'enforce', seats: ['s0'], maxPerAccessible: 1, accessible: 0 },
    ]);
    expect(evaluate([companion('enforce')], 'AC')).toEqual([]);
    // Two companions for one accessible seat: the second is over.
    expect(evaluate([companion('warn')], 'ACC')).toEqual([
      { rule: 'ada_companion', severity: 'warn', seats: ['s2'], maxPerAccessible: 1, accessible: 1 },
    ]);
    expect(evaluate([companion('warn', 2)], 'ACC')).toEqual([]);
    // Ordinary seats are never counted.
    expect(evaluate([companion('enforce')], '...')).toEqual([]);
  });

  it('ends with the accessible-seat release, when there is one; otherwise always applies', () => {
    expect(evaluate([companion('enforce'), ada('warn', 7)], 'C', { now: late })).toEqual([]);
    expect(evaluate([companion('enforce'), ada('warn', 7)], 'C', { now: early })).toHaveLength(1);
    expect(evaluate([companion('enforce')], 'C', { now: late })).toHaveLength(1);
  });

  it('never applies when the organizer seats guests', () => {
    expect(
      evaluateSeatRules([companion('enforce')], { context: 'assign', seats: pick('CC'), startsAt, now: early }),
    ).toEqual([]);
  });

  it('a buyer who needs an accessible seat may take a kept-back one (the companion rule still counts)', () => {
    expect(evaluate([ada('enforce')], 'A')).toHaveLength(1);
    expect(evaluate([ada('enforce')], 'A', { accessibleNeed: true })).toEqual([]);
    expect(evaluate([ada('enforce'), companion('enforce')], 'ACC', { accessibleNeed: true })).toEqual([
      { rule: 'ada_companion', severity: 'enforce', seats: ['s2'], maxPerAccessible: 1, accessible: 1 },
    ]);
  });

  it('enforced companion hits block online; staff may override at the box office', () => {
    const hits = evaluate([companion('enforce')], 'C');
    expect(blockingHits(hits, { context: 'checkout', override: true })).toHaveLength(1);
    expect(blockingHits(hits, { context: 'box_office', override: true })).toEqual([]);
  });
});
