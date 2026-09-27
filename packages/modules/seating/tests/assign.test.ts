import { describe, expect, it } from 'vitest';
import { assignSeatState, pickSeats } from '../src/index.ts';

const seat = (id: string, free = true, accessible = false) => ({ seatUuid: id, free, accessible });

describe('seat assignment rules (M1.7d)', () => {
  it('maps seat status and block reason to what the organizer sees', () => {
    expect(assignSeatState('available', null)).toBe('free');
    expect(assignSeatState('blocked', 'assigned')).toBe('assigned');
    expect(assignSeatState('blocked', 'channel')).toBe('reserved');
    expect(assignSeatState('blocked', 'ada')).toBe('reserved');
    expect(assignSeatState('blocked', 'kill')).toBe('blocked');
    expect(assignSeatState('held', null)).toBe('held');
    expect(assignSeatState('sold', null)).toBe('sold');
  });

  it('picks free seats in plan order, accessible seats last', () => {
    const seats = [seat('1', true, true), seat('2', false), seat('3'), seat('4'), seat('5', true, true)];
    expect(pickSeats(seats, 2)).toEqual({ seats: ['3', '4'], fits: 4 });
    expect(pickSeats(seats, 3)).toEqual({ seats: ['3', '4', '1'], fits: 4 });
    expect(pickSeats(seats, 4)).toEqual({ seats: ['3', '4', '1', '5'], fits: 4 });
  });

  it("says how many fit when a group doesn't", () => {
    expect(pickSeats([seat('1'), seat('2', false)], 2)).toEqual({ seats: null, fits: 1 });
    expect(pickSeats([], 1)).toEqual({ seats: null, fits: 0 });
    expect(pickSeats([seat('1')], 0)).toEqual({ seats: [], fits: 1 });
  });
});
