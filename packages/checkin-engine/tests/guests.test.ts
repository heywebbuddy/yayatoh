import { describe, expect, it } from 'vitest';
import {
  boardGroups,
  boardPages,
  correctedArrival,
  earlierArrival,
  type GuestSnapshot,
  matchGuestByName,
  normalizeName,
  type SnapshotGuest,
  searchGuests,
  snapshotLabels,
} from '../src/index.ts';

let n = 0;
const guest = (
  first: string | null,
  last: string | null,
  over: Partial<SnapshotGuest> = {},
): SnapshotGuest => ({
  id: `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  firstName: first,
  lastName: last,
  name: first ? [first, last].filter(Boolean).join(' ') : null,
  guestOf: null,
  status: 'attending',
  places: [{ chart: null, kind: 'table', label: 'Table 1' }],
  arrivedAt: null,
  ...over,
});

const luis = guest('Luis', 'López');
const plusOne = guest(null, null, {
  guestOf: 'Luis López',
  places: [{ chart: null, kind: 'table', label: 'Table 1' }],
});
const ana = guest('Ana', 'García');
const mei = guest('Mei', 'Chen', { places: [{ chart: null, kind: 'table', label: 'Table 2' }] });
const zed = guest('Zed', 'Ålund', { places: [{ chart: 'Reception', kind: 'table', label: 'Table 9' }] });
const declined = guest('Dee', 'Clined', { status: 'declined' });
const unseated = guest('Una', 'Seated', { places: [] });
const twinA = guest('Sam', 'Lee');
const twinB = guest('Sam', 'Lee');
const digit = guest('3rd', 'Wheel', { lastName: '3Wheel' });

const snap: GuestSnapshot = {
  version: 1,
  eventId: '00000000-0000-7000-8000-000000000000',
  generatedAt: '2027-06-01T18:00:00.000Z',
  parties: [
    { id: 'p1', name: 'The Garcias', tags: ['Bride', 'Family'], guests: [luis, plusOne, ana] },
    { id: 'p2', name: 'Chen', tags: ['Groom'], guests: [mei, declined] },
    { id: 'p3', name: 'Lund', tags: ['bride', 'Work'], guests: [zed, unseated] },
    { id: 'p4', name: 'Lee twins', tags: [], guests: [twinA, twinB, digit] },
  ],
};

describe('normalizeName', () => {
  it('folds accents, case, punctuation and spacing', () => {
    expect(normalizeName("  José   O'Neil-Ávila ")).toBe('jose oneilavila');
    expect(normalizeName('LUIS LÓPEZ')).toBe(normalizeName('luis lopez'));
  });
});

describe('matchGuestByName (guest kiosk)', () => {
  it('finds exactly one guest by their full name, accents and case aside', () => {
    const m = matchGuestByName(snap, 'luis lopez');
    expect(m.status).toBe('found');
    if (m.status === 'found') {
      expect(m.guest.id).toBe(luis.id);
      expect(m.party.name).toBe('The Garcias');
    }
  });

  it('never matches a partial name, a first name alone or an unnamed plus-one', () => {
    expect(matchGuestByName(snap, 'Luis').status).toBe('no_match');
    expect(matchGuestByName(snap, 'Luis L').status).toBe('no_match');
    expect(matchGuestByName(snap, 'lopez').status).toBe('no_match');
    expect(matchGuestByName(snap, 'Guest of Luis López').status).toBe('no_match');
    expect(matchGuestByName(snap, '').status).toBe('no_match');
  });

  it('sends shared names and declined guests to staff', () => {
    expect(matchGuestByName(snap, 'Sam Lee').status).toBe('see_staff');
    expect(matchGuestByName(snap, 'Dee Clined').status).toBe('see_staff');
  });
});

describe('searchGuests (staff check-in by name or party with labels)', () => {
  it('a party matched by its name shows all its guests', () => {
    const r = searchGuests(snap, 'garcias');
    expect(r.map((p) => p.id)).toEqual(['p1']);
    expect(r[0]?.guests).toHaveLength(3);
  });

  it('a guest name shows only the matching guests of their party', () => {
    const r = searchGuests(snap, 'mei');
    expect(r.map((p) => p.id)).toEqual(['p2']);
    expect(r[0]?.guests.map((g) => g.id)).toEqual([mei.id]);
    // An unnamed plus-one is found by their host's name.
    expect(searchGuests(snap, 'lopez')[0]?.guests.map((g) => g.id)).toEqual([luis.id, plusOne.id]);
  });

  it('labels filter case-insensitively, every chosen label required; labels alone list parties', () => {
    expect(searchGuests(snap, '', ['Bride']).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(searchGuests(snap, '', ['bride', 'family']).map((p) => p.id)).toEqual(['p1']);
    expect(searchGuests(snap, 'chen', ['Bride'])).toEqual([]);
    expect(searchGuests(snap, '   ')).toEqual([]);
  });

  it('caps the results', () => {
    expect(searchGuests(snap, 'e', [], 2)).toHaveLength(2);
  });

  it('collects the labels A–Z, once each whatever their case', () => {
    expect(snapshotLabels(snap, 'en')).toEqual(['Bride', 'Family', 'Groom', 'Work']);
  });
});

describe('boardGroups (the A–Z board)', () => {
  it('by last name, grouped by letter (accents folded), # last; no plus-ones, declined or unseated', () => {
    const groups = boardGroups(snap, 'en');
    expect(groups.map((g) => g.letter)).toEqual(['A', 'C', 'G', 'L', '#']);
    const names = groups.flatMap((g) => g.entries.map((e) => e.name));
    expect(names).toEqual([
      'Zed Ålund',
      'Mei Chen',
      'Ana García',
      'Sam Lee',
      'Sam Lee',
      'Luis López',
      '3rd Wheel',
    ]);
    expect(names).not.toContain('Dee Clined');
    expect(names).not.toContain('Una Seated');
    expect(groups[0]?.entries[0]?.places).toEqual([{ chart: 'Reception', kind: 'table', label: 'Table 9' }]);
  });

  it('pages never exceed their size and keep every entry once, letters repeated across a break', () => {
    const groups = boardGroups(snap, 'en');
    const pages = boardPages(groups, 4);
    for (const p of pages) expect(p.reduce((s, g) => s + 1 + g.entries.length, 0)).toBeLessThanOrEqual(4);
    expect(pages.flat().flatMap((g) => g.entries.map((e) => e.guestId))).toEqual(
      groups.flatMap((g) => g.entries.map((e) => e.guestId)),
    );
    expect(boardPages([], 10)).toEqual([]);
  });
});

describe('arrivals', () => {
  const now = new Date('2027-06-01T20:00:00Z');
  it('corrects the device clock and never dates an arrival in the future', () => {
    expect(correctedArrival(new Date('2027-06-01T19:58:00Z'), 60_000, now).toISOString()).toBe(
      '2027-06-01T19:59:00.000Z',
    );
    expect(correctedArrival(new Date('2027-06-01T20:30:00Z'), 0, now)).toEqual(now);
  });
  it('first wins', () => {
    expect(earlierArrival(null, now)).toBe(true);
    expect(earlierArrival(now, new Date(now.getTime() - 1))).toBe(true);
    expect(earlierArrival(now, now)).toBe(false);
  });
});
