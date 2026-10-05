import { describe, expect, it } from 'vitest';
import {
  cellKey,
  groupState,
  type InviteGuest,
  type InviteParty,
  invitedBySubEvent,
  isInvited,
  moveInOrder,
  partyMatches,
  planInvitations,
  subEventWindow,
  targetGuests,
  uninvitedWith,
  windowInputs,
} from '../src/domain/invitations.ts';

const guest = (id: string, partyId: string, hostGuestId: string | null = null): InviteGuest => ({
  id,
  partyId,
  kind: hostGuestId ? 'plus_one' : 'guest',
  hostGuestId,
});
const party = (id: string, over: Partial<InviteParty> = {}): InviteParty => ({
  id,
  side: null,
  vip: false,
  tags: [],
  ...over,
});

// Two parties: Garcia (Luis + his plus-one, Ana) and Chen (Mei).
const parties = [
  party('garcia', { side: 'Bride', vip: true, tags: ['Family'] }),
  party('chen', { side: 'Groom' }),
];
const guests = [
  guest('luis', 'garcia'),
  guest('luis+1', 'garcia', 'luis'),
  guest('ana', 'garcia'),
  guest('mei', 'chen'),
];

describe('invitation matrix (M4.1c)', () => {
  it('a plus-one follows their host; "everyone invited" covers every guest with no rows', () => {
    const rows = new Set([cellKey('ceremony', 'luis')]);
    const plusOne = guests[1] as InviteGuest;
    expect(isInvited(plusOne, { id: 'ceremony', inviteAll: false }, rows)).toBe(true);
    expect(isInvited(plusOne, { id: 'reception', inviteAll: false }, rows)).toBe(false);
    expect(isInvited(guests[3] as InviteGuest, { id: 'reception', inviteAll: true }, new Set())).toBe(true);
  });

  it('"everyone invited" includes parties added later', () => {
    const subs = [{ id: 'ceremony', inviteAll: true }];
    const before = invitedBySubEvent(guests, subs, []);
    expect(before.get('ceremony')?.size).toBe(4);
    // A party imported or added after the switch: invited with no new rows.
    const later = [...guests, guest('zoe', 'new'), guest('zoe+1', 'new', 'zoe')];
    expect([...(invitedBySubEvent(later, subs, []).get('ceremony') ?? [])]).toEqual(
      expect.arrayContaining(['zoe', 'zoe+1']),
    );
  });

  it('targets: a cell, a whole party, a filter, everyone; plus-ones are never picked directly', () => {
    expect(targetGuests({ kind: 'guests', guestIds: ['luis'] }, parties, guests)).toEqual({ ids: ['luis'] });
    expect(targetGuests({ kind: 'guests', guestIds: ['luis+1'] }, parties, guests)).toEqual({
      refusal: 'plus_one_follows_host',
    });
    expect(targetGuests({ kind: 'guests', guestIds: ['nobody'] }, parties, guests)).toEqual({
      refusal: 'unknown_guest',
    });
    expect(targetGuests({ kind: 'parties', partyIds: ['garcia'] }, parties, guests)).toEqual({
      ids: ['luis', 'ana'],
    });
    expect(targetGuests({ kind: 'parties', partyIds: ['elsewhere'] }, parties, guests)).toEqual({
      refusal: 'unknown_party',
    });
    expect(targetGuests({ kind: 'filter', side: 'groom' }, parties, guests)).toEqual({ ids: ['mei'] });
    expect(targetGuests({ kind: 'filter', tag: 'FAMILY' }, parties, guests)).toEqual({
      ids: ['luis', 'ana'],
    });
    expect(targetGuests({ kind: 'filter', vip: false }, parties, guests)).toEqual({ ids: ['mei'] });
    expect(targetGuests({ kind: 'all' }, parties, guests)).toEqual({ ids: ['luis', 'ana', 'mei'] });
  });

  it('filters match like the guest list (case-insensitive side and tag, VIP)', () => {
    const p = party('p', { side: 'Bride', tags: ['Out of town'], vip: true });
    expect(partyMatches(p, { side: 'bride', tag: 'out of TOWN', vip: true })).toBe(true);
    expect(partyMatches(p, { vip: false })).toBe(false);
    expect(partyMatches(p, {})).toBe(true);
    expect(partyMatches(party('q'), { side: 'Bride' })).toBe(false);
  });

  it('bulk plans add only what is missing and remove only what exists (repeatable)', () => {
    const rows = [{ subEventId: 'ceremony', guestId: 'luis' }];
    expect(planInvitations(['ceremony', 'reception'], ['luis', 'ana'], rows, true)).toEqual({
      add: [
        { subEventId: 'ceremony', guestId: 'ana' },
        { subEventId: 'reception', guestId: 'luis' },
        { subEventId: 'reception', guestId: 'ana' },
      ],
      remove: [],
    });
    expect(planInvitations(['ceremony'], ['luis', 'ana'], rows, false)).toEqual({
      add: [],
      remove: [{ subEventId: 'ceremony', guestId: 'luis' }],
    });
    expect(planInvitations(['ceremony'], ['luis'], rows, true)).toEqual({ add: [], remove: [] });
  });

  it('uninviting a guest also takes their plus-one', () => {
    expect(uninvitedWith('luis', guests)).toEqual(['luis', 'luis+1']);
    expect(uninvitedWith('mei', guests)).toEqual(['mei']);
  });

  it('group states for a whole party or sub-event', () => {
    expect(groupState([])).toBe('none');
    expect(groupState([false, false])).toBe('none');
    expect(groupState([true, false])).toBe('some');
    expect(groupState([true, true])).toBe('all');
  });

  it('moves a sub-event up and down; not past either end', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'up')).toBeNull();
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'down')).toBeNull();
    expect(moveInOrder(['a'], 'x', 'up')).toBeNull();
  });
});

describe('sub-event times in the event timezone (ADR 0015)', () => {
  it('a reception across the autumn DST change lasts its real length', () => {
    // New York falls back at 02:00 on 2026-11-01: 00:30 → 03:30 wall clock is four hours.
    const w = subEventWindow('2026-11-01T00:30', '2026-11-01T03:30', 'America/New_York');
    if ('refusal' in w) throw new Error('refused');
    expect(w.startsAt.toISOString()).toBe('2026-11-01T04:30:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-11-01T08:30:00.000Z');
    expect((w.endsAt.getTime() - w.startsAt.getTime()) / 3_600_000).toBe(4);
    expect(windowInputs(w, 'America/New_York')).toEqual({
      start: '2026-11-01T00:30',
      end: '2026-11-01T03:30',
    });
  });

  it('across the spring change: an hour shorter; a time in the gap moves forward', () => {
    // Clocks jump from 02:00 to 03:00 on 2026-03-08 in New York.
    const w = subEventWindow('2026-03-08T01:00', '2026-03-08T04:00', 'America/New_York');
    if ('refusal' in w) throw new Error('refused');
    expect((w.endsAt.getTime() - w.startsAt.getTime()) / 3_600_000).toBe(2);
    const gap = subEventWindow('2026-03-08T02:30', '2026-03-08T05:00', 'America/New_York');
    if ('refusal' in gap) throw new Error('refused');
    expect(windowInputs(gap, 'America/New_York').start).toBe('2026-03-08T03:30');
  });

  it('the same wall-clock ceremony is a different instant in another zone; end must follow start', () => {
    const ny = subEventWindow('2027-06-12T16:00', '2027-06-12T17:00', 'America/New_York');
    const lisbon = subEventWindow('2027-06-12T16:00', '2027-06-12T17:00', 'Europe/Lisbon');
    if ('refusal' in ny || 'refusal' in lisbon) throw new Error('refused');
    expect(ny.startsAt.toISOString()).toBe('2027-06-12T20:00:00.000Z');
    expect(lisbon.startsAt.toISOString()).toBe('2027-06-12T15:00:00.000Z');
    expect(subEventWindow('2027-06-12T17:00', '2027-06-12T16:00', 'Europe/Lisbon')).toEqual({
      refusal: 'end_before_start',
    });
    expect(subEventWindow('2027-06-12T17:00', '2027-06-12T17:00', 'Europe/Lisbon')).toEqual({
      refusal: 'end_before_start',
    });
  });
});
