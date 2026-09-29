import { describe, expect, it } from 'vitest';
import {
  changedFields,
  countGuests,
  displayName,
  fullName,
  type GuestLike,
  movingIds,
  nextPrimary,
  normalizeTags,
  orderWithPlusOnes,
  parseTags,
  plusOneRefusal,
} from '../src/domain/guests.ts';

const g = (id: string, over: Partial<GuestLike> = {}): GuestLike => ({
  id,
  kind: 'guest',
  hostGuestId: null,
  firstName: id,
  lastName: null,
  ageClass: 'adult',
  ...over,
});
const plus = (id: string, host: string, over: Partial<GuestLike> = {}) =>
  g(id, { kind: 'plus_one', hostGuestId: host, firstName: null, ...over });

describe('party counts', () => {
  it('counts parties, VIPs, age classes and pending plus-ones', () => {
    expect(
      countGuests([
        { vip: true, guests: [g('a'), g('b', { ageClass: 'child' }), plus('p', 'a')] },
        { vip: false, guests: [g('c', { ageClass: 'infant' }), plus('q', 'c', { firstName: 'Named' })] },
        { vip: false, guests: [] },
      ]),
    ).toEqual({
      parties: 3,
      vipParties: 1,
      guests: 5,
      adults: 3,
      children: 1,
      infants: 1,
      plusOnesPending: 1,
    });
  });

  it('is all zeros for an empty list', () => {
    expect(countGuests([])).toEqual({
      parties: 0,
      vipParties: 0,
      guests: 0,
      adults: 0,
      children: 0,
      infants: 0,
      plusOnesPending: 0,
    });
  });
});

describe('name formatting', () => {
  it('joins first and last names, trimming blanks', () => {
    expect(fullName({ firstName: 'Ana', lastName: 'García' })).toBe('Ana García');
    expect(fullName({ firstName: ' Ana ', lastName: '  ' })).toBe('Ana');
    expect(fullName({ firstName: null, lastName: null })).toBeNull();
  });

  it('shows an unnamed plus-one as the guest of their host', () => {
    const host = g('h', { firstName: 'Luis', lastName: 'Garcia' });
    const p = plus('p', 'h');
    const byId = new Map([host, p].map((x) => [x.id, x]));
    expect(displayName(host, byId)).toEqual({ name: 'Luis Garcia' });
    expect(displayName(p, byId)).toEqual({ guestOf: 'Luis Garcia' });
    expect(displayName({ ...p, firstName: 'Ana' }, byId)).toEqual({ name: 'Ana' });
    expect(displayName(plus('x', 'missing'), byId)).toEqual({ guestOf: '?' });
  });
});

describe('plus-one rules', () => {
  const host = g('h');
  it('allows one plus-one per named guest while the party has room', () => {
    expect(plusOneRefusal(host, [host], 20)).toBeNull();
    expect(plusOneRefusal(host, [host, plus('p', 'h')], 20)).toBe('host_has_plus_one');
    expect(plusOneRefusal(plus('p', 'h'), [host], 20)).toBe('host_is_plus_one');
    expect(plusOneRefusal(host, [host, g('b')], 2)).toBe('party_full');
  });

  it('moves a guest with their plus-one; a plus-one never moves alone', () => {
    const party = [host, plus('p', 'h'), g('b')];
    expect(movingIds(host, party)).toEqual(['h', 'p']);
    expect(movingIds(g('b'), party)).toEqual(['b']);
    expect(movingIds(plus('p', 'h'), party)).toBeNull();
  });

  it('orders plus-ones right after their host', () => {
    const list = [
      { id: 'a', hostGuestId: null },
      { id: 'b', hostGuestId: null },
      { id: 'pb', hostGuestId: 'b' },
      { id: 'pa', hostGuestId: 'a' },
      { id: 'orphan', hostGuestId: 'gone' },
    ];
    expect(orderWithPlusOnes(list).map((x) => x.id)).toEqual(['a', 'pa', 'b', 'pb', 'orphan']);
  });

  it('picks the first named adult as primary, never a plus-one', () => {
    expect(
      nextPrimary([plus('p', 'h', { firstName: 'Named' }), g('kid', { ageClass: 'child' }), g('ad')]),
    ).toBe('ad');
    expect(nextPrimary([g('kid', { ageClass: 'child' })])).toBe('kid');
    expect(nextPrimary([plus('p', 'h')])).toBeNull();
  });
});

describe('tags and changes', () => {
  it('normalizes tags like chips', () => {
    expect(normalizeTags([' Family ', 'family', '', 'Out  of town'])).toEqual(['Family', 'Out of town']);
    expect(parseTags('Work, work,  ,VIP table')).toEqual(['Work', 'VIP table']);
  });

  it('lists changed fields only', () => {
    expect(
      changedFields(
        { name: 'A', tags: ['x'], side: null, vip: false },
        { name: 'A', tags: ['x', 'y'], side: '', vip: undefined },
      ),
    ).toEqual(['tags', 'side']);
  });
});
