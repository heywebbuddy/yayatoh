import { describe, expect, it } from 'vitest';
import { declinedSeated, fitAt, freeSeats, unseatedOf, vipWarning } from '../src/client.ts';

const table = (capacity: number, taken = 0, vip = false) => ({ itemId: 't1', capacity, taken, vip });
const at = (guestId: string, itemId = 't1') => ({ guestId, itemId });

describe('guest seating rules (M4.3a)', () => {
  it('counts free seats after tickets and the guests already seated there', () => {
    expect(freeSeats(table(8), [])).toBe(8);
    expect(freeSeats(table(8, 2), [at('a'), at('b'), at('c', 't2')])).toBe(4);
    // Over capacity (the plan shrank): never below zero.
    expect(freeSeats(table(2), [at('a'), at('b'), at('c')])).toBe(0);
  });

  it('seats a party all or nothing and says how many fit', () => {
    expect(fitAt(table(4), [at('x')], ['a', 'b', 'c'])).toEqual({ ok: true, moving: ['a', 'b', 'c'] });
    expect(fitAt(table(4), [at('x'), at('y')], ['a', 'b', 'c'])).toEqual({ ok: false, asked: 3, fits: 2 });
    expect(fitAt(table(4, 4), [], ['a'])).toEqual({ ok: false, asked: 1, fits: 0 });
  });

  it('does not count guests already at the table again (a party re-dropped where it sits)', () => {
    expect(fitAt(table(3), [at('a'), at('b')], ['a', 'b', 'c'])).toEqual({ ok: true, moving: ['c'] });
    expect(fitAt(table(2), [at('a'), at('b')], ['a', 'b', 'a'])).toEqual({ ok: true, moving: [] });
  });

  it('counts guests moving from another table as needing a seat here', () => {
    expect(fitAt(table(1), [at('a', 't2')], ['a'])).toEqual({ ok: true, moving: ['a'] });
    expect(fitAt(table(1), [at('z'), at('a', 't2')], ['a'])).toEqual({ ok: false, asked: 1, fits: 0 });
  });

  it('warns about VIP zones both ways, never refuses', () => {
    expect(vipWarning(true, false)).toBe('vip_outside');
    expect(vipWarning(false, true)).toBe('not_vip_inside');
    expect(vipWarning(true, true)).toBeNull();
    expect(vipWarning(false, false)).toBeNull();
  });

  it('keeps declined guests out of the queue and flags them when still seated', () => {
    const guests = [
      { id: 'a', status: 'attending' as const, itemId: null },
      { id: 'b', status: 'pending' as const, itemId: null },
      { id: 'c', status: 'declined' as const, itemId: null },
      { id: 'd', status: 'declined' as const, itemId: 't1' },
      { id: 'e', status: 'attending' as const, itemId: 't1' },
    ];
    expect(unseatedOf(guests).map((g) => g.id)).toEqual(['a', 'b']);
    expect(declinedSeated(guests).map((g) => g.id)).toEqual(['d']);
  });
});
