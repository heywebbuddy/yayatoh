import { describe, expect, it } from 'vitest';
import {
  checkHouseholdAnswers,
  LOOKUP_ALPHABET,
  lookupCodeFrom,
  normalizeLookupCode,
  normalizePin,
  participationRsvp,
  partyRsvpState,
  type RsvpGuest,
  rsvpOpen,
  strictFullName,
  strictName,
  tally,
} from '../src/domain/rsvp.ts';

const at = (iso: string) => new Date(iso);

describe('party RSVP states (M4.1d)', () => {
  it('invited → sent → viewed → responded: the furthest step wins', () => {
    expect(partyRsvpState(null)).toBe('invited');
    expect(partyRsvpState({ sentAt: null, viewedAt: null, respondedAt: null })).toBe('invited');
    expect(partyRsvpState({ sentAt: at('2030-01-01'), viewedAt: null, respondedAt: null })).toBe('sent');
    // Opened without a recorded send (a link copied by hand): viewed.
    expect(partyRsvpState({ sentAt: null, viewedAt: at('2030-01-02'), respondedAt: null })).toBe('viewed');
    expect(
      partyRsvpState({ sentAt: at('2030-01-01'), viewedAt: at('2030-01-02'), respondedAt: at('2030-01-03') }),
    ).toBe('responded');
    // A paper answer entered by the host: responded without a view.
    expect(partyRsvpState({ sentAt: null, viewedAt: null, respondedAt: at('2030-01-03') })).toBe('responded');
  });

  it('the deadline is the first locked instant; reopened parties may answer after it', () => {
    const deadline = at('2030-05-01T04:59:00Z');
    expect(rsvpOpen(null, at('2099-01-01'), false)).toBe(true);
    expect(rsvpOpen(deadline, at('2030-05-01T04:58:59Z'), false)).toBe(true);
    expect(rsvpOpen(deadline, deadline, false)).toBe(false);
    expect(rsvpOpen(deadline, at('2030-06-01'), false)).toBe(false);
    expect(rsvpOpen(deadline, at('2030-06-01'), true)).toBe(true);
  });
});

describe('strict name matching (P4-2: exact full name, nothing partial or fuzzy)', () => {
  it('ignores case, surrounding and repeated spaces and compatibility forms only', () => {
    expect(strictName('  Ana   María  López ')).toBe('ana maría lópez');
    expect(strictName('ANA MARÍA LÓPEZ')).toBe(strictName('ana maría lópez'));
    // NFKC: a full-width letter is the same letter; a decomposed accent is the same accent.
    expect(strictName('Ａna')).toBe('ana');
    expect(strictName('López')).toBe(strictName('López'));
  });

  it('a partial name, a missing accent or another order is a different name', () => {
    const full = strictFullName({ firstName: 'Ana', lastName: 'López' });
    expect(full).toBe('ana lópez');
    expect(strictName('Ana')).not.toBe(full);
    expect(strictName('Lopez')).not.toBe(full);
    expect(strictName('Ana Lopez')).not.toBe(full);
    expect(strictName('López Ana')).not.toBe(full);
    expect(strictName('Ana Lóp')).not.toBe(full);
  });

  it('a guest without a last name is their first name; an unnamed plus-one has no name', () => {
    expect(strictFullName({ firstName: 'Cher', lastName: null })).toBe('cher');
    expect(strictFullName({ firstName: null, lastName: null })).toBe('');
  });
});

describe('codes typed from paper', () => {
  it('lookup codes use 8 characters without look-alikes', () => {
    const code = lookupCodeFrom(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 255]));
    expect(code).toHaveLength(8);
    for (const c of code) expect(LOOKUP_ALPHABET).toContain(c);
    for (const bad of ['0', 'O', '1', 'I', 'L', 'U']) expect(LOOKUP_ALPHABET).not.toContain(bad);
    expect(() => lookupCodeFrom(new Uint8Array(3))).toThrow();
  });

  it('normalizes what people type', () => {
    expect(normalizeLookupCode('ab2c-d3ef')).toBe('AB2CD3EF');
    expect(normalizeLookupCode(' AB2C D3EF ')).toBe('AB2CD3EF');
    expect(normalizeLookupCode('short')).toBeNull();
    expect(normalizeLookupCode('AB2C%D3EF')).toBeNull();
    expect(normalizePin(' 123 456 ')).toBe('123456');
    expect(normalizePin('12345')).toBeNull();
    expect(normalizePin('12345a')).toBeNull();
  });
});

describe('household answers', () => {
  const party: RsvpGuest[] = [
    { id: 'luis', kind: 'guest', hostGuestId: null, firstName: 'Luis' },
    { id: 'ana', kind: 'guest', hostGuestId: null, firstName: 'Ana' },
    { id: 'plus', kind: 'plus_one', hostGuestId: 'luis', firstName: null },
  ];
  // Everyone at the ceremony; only Luis (and so his plus-one) at the reception.
  const invited = new Map([
    ['ceremony', new Set(['luis', 'ana', 'plus'])],
    ['reception', new Set(['luis', 'plus'])],
  ]);
  const all = (status: 'attending' | 'declined') => [
    { guestId: 'luis', subEventId: 'ceremony', status },
    { guestId: 'ana', subEventId: 'ceremony', status },
    { guestId: 'plus', subEventId: 'ceremony', status },
    { guestId: 'luis', subEventId: 'reception', status },
    { guestId: 'plus', subEventId: 'reception', status },
  ];

  it('accepts one answer per invited guest and sub-event, with the plus-one named', () => {
    expect(
      checkHouseholdAnswers(party, invited, all('attending'), [
        { guestId: 'plus', firstName: 'Sam', lastName: 'Lee' },
      ]),
    ).toBeNull();
    // Declining everything needs no plus-one name.
    expect(checkHouseholdAnswers(party, invited, all('declined'), [])).toBeNull();
  });

  it('refuses an answer for a sub-event the guest is not invited to', () => {
    expect(
      checkHouseholdAnswers(
        party,
        invited,
        [...all('declined'), { guestId: 'ana', subEventId: 'reception', status: 'attending' }],
        [],
      ),
    ).toEqual({ reason: 'not_invited', guestId: 'ana', subEventId: 'reception' });
  });

  it('refuses guests of another party, duplicates, missing answers and unnamed attending plus-ones', () => {
    expect(
      checkHouseholdAnswers(
        party,
        invited,
        [{ guestId: 'stranger', subEventId: 'ceremony', status: 'attending' }],
        [],
      ),
    ).toEqual({ reason: 'not_in_party', guestId: 'stranger' });
    expect(
      checkHouseholdAnswers(party, invited, [...all('declined'), ...all('declined').slice(0, 1)], []),
    ).toEqual({
      reason: 'duplicate_answer',
      guestId: 'luis',
      subEventId: 'ceremony',
    });
    expect(checkHouseholdAnswers(party, invited, all('declined').slice(1), [])).toEqual({
      reason: 'missing_answer',
      guestId: 'luis',
      subEventId: 'ceremony',
    });
    expect(checkHouseholdAnswers(party, invited, all('attending'), [])).toEqual({
      reason: 'plus_one_name_required',
      guestId: 'plus',
    });
    expect(
      checkHouseholdAnswers(party, invited, all('attending'), [
        { guestId: 'ana', firstName: 'X', lastName: null },
      ]),
    ).toEqual({ reason: 'not_a_plus_one', guestId: 'ana' });
  });
});

describe('counts', () => {
  it('tallies attending, declined and awaiting per sub-event', () => {
    expect(
      tally(
        new Set(['a', 'b', 'c', 'd']),
        new Map([
          ['a', 'attending'],
          ['b', 'declined'],
          ['x', 'attending'],
        ] as const),
      ),
    ).toEqual({ invited: 4, attending: 1, declined: 1, awaiting: 2 });
  });

  it('one contact’s RSVP for event_participation', () => {
    expect(participationRsvp([])).toBeNull();
    expect(participationRsvp(['declined', 'attending'])).toBe('attending');
    expect(participationRsvp(['declined', 'declined'])).toBe('declined');
    expect(participationRsvp(['declined', null])).toBe('awaiting');
    expect(participationRsvp([null])).toBe('awaiting');
  });
});
