import { describe, expect, it } from 'vitest';
import { mealTally, rsvpPendingCounts, type SocialGuest } from '../src/domain/social.ts';

const g = (id: string, partyId: string, extra: Partial<SocialGuest> = {}): SocialGuest => ({
  id,
  partyId,
  hasTicket: false,
  meal: null,
  ...extra,
});

describe('rsvpPendingCounts (M4.6a)', () => {
  const guests = [g('a', 'p1'), g('b', 'p1'), g('c', 'p2'), g('d', 'p3'), g('t', 'p4', { hasTicket: true })];
  const invited = new Map([
    ['ceremony', new Set(['a', 'b', 'c', 't'])],
    ['reception', new Set(['a'])],
  ]);

  it('counts invited guests with an invitation still unanswered, and their parties', () => {
    const r = rsvpPendingCounts(guests, invited, new Map(), new Set());
    // d is invited to nothing (not asked); t holds a gala ticket (coming).
    expect(r).toEqual({ invited: 3, pending: 3, pendingParties: 2, responded: 0, notSent: 3 });
  });

  it('a guest who answered only part of their invitations is still pending; all answered clears', () => {
    const responses = new Map([
      [
        'ceremony',
        new Map([
          ['a', 'attending' as const],
          ['b', 'declined' as const],
        ]),
      ],
    ]);
    const r = rsvpPendingCounts(guests, invited, responses, new Set(['p1']));
    expect(r).toEqual({ invited: 3, pending: 2, pendingParties: 2, responded: 1, notSent: 1 });
    responses.set('reception', new Map([['a', 'declined' as const]]));
    responses.get('ceremony')?.set('c', 'attending');
    expect(rsvpPendingCounts(guests, invited, responses, new Set())).toEqual({
      invited: 3,
      pending: 0,
      pendingParties: 0,
      responded: 3,
      notSent: 0,
    });
  });
});

describe('mealTally (M4.6a)', () => {
  const menu = [
    { id: 'm1', label: 'Beef', notes: null },
    { id: 'm2', label: 'Risotto', notes: 'Vegetarian' },
  ];

  it('counts attending guests by menu option (case-insensitive), other choices and no choice', () => {
    const t = mealTally(menu, ['beef', 'Beef', 'Risotto', 'Lobster', null, null]);
    expect(t).toEqual({
      attending: 6,
      options: [
        { label: 'Beef', notes: null, count: 2 },
        { label: 'Risotto', notes: 'Vegetarian', count: 1 },
      ],
      other: 1,
      none: 2,
    });
  });

  it('no menu: every choice counts as other, none as none', () => {
    expect(mealTally([], ['Fish', null])).toEqual({ attending: 2, options: [], other: 1, none: 1 });
  });
});
