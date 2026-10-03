import { describe, expect, it } from 'vitest';
import { leadSeatStanding } from '../src/domain/lead-seat.ts';

const seat = (accountId: string, minute: number, id = accountId) => ({
  id,
  accountId,
  createdAt: new Date(Date.UTC(2026, 10, 1, 9, minute)),
});

describe('lead seat standing (M5.6b)', () => {
  const seats = [seat('c', 3), seat('a', 1), seat('b', 2)];
  it('licenses the oldest seats up to the allowance', () => {
    expect(leadSeatStanding(seats, 'a', 2)).toBe('licensed');
    expect(leadSeatStanding(seats, 'b', 2)).toBe('licensed');
    expect(leadSeatStanding(seats, 'c', 2)).toBe('over_allowance');
    expect(leadSeatStanding(seats, 'c', 3)).toBe('licensed');
  });
  it('refuses people without a seat and every seat when the allowance is 0', () => {
    expect(leadSeatStanding(seats, 'z', 5)).toBe('unlicensed');
    expect(leadSeatStanding(seats, 'a', 0)).toBe('over_allowance');
  });
  it('breaks ties on the seat id', () => {
    const tie = [seat('x', 1, 'b-id'), seat('y', 1, 'a-id')];
    expect(leadSeatStanding(tie, 'y', 1)).toBe('licensed');
    expect(leadSeatStanding(tie, 'x', 1)).toBe('over_allowance');
  });
});
