import { describe, expect, it } from 'vitest';
import {
  guestPassContent,
  guestPassSerial,
  hubTally,
  nextProgramItem,
  PASS_SEATS_MAX,
  PASS_TEXT_MAX,
} from '../src/domain/hub.ts';
import { FAKE_PASS_CONTENT_TYPE, fakeGuestPassProvider } from '../src/wallet-pass.ts';

const at = (h: number) => new Date(Date.UTC(2030, 5, 1, h));
const item = (name: string, from: number, to: number, place: string | null = null) => ({
  name,
  startsAt: at(from),
  endsAt: at(to),
  place,
});

describe('hubTally (M4.7a)', () => {
  it('counts every invitation by its answer', () => {
    expect(hubTally([])).toEqual({ attending: 0, declined: 0, awaiting: 0 });
    expect(
      hubTally([{ status: 'attending' }, { status: 'declined' }, { status: null }, { status: 'attending' }]),
    ).toEqual({ attending: 2, declined: 1, awaiting: 1 });
  });
});

describe('nextProgramItem (M4.7a)', () => {
  const program = [item('Reception', 18, 23), item('Ceremony', 15, 16), item('Dinner', 16, 18)];
  it('is the part happening now, else the next to start, in time order whatever the input order', () => {
    expect(nextProgramItem(program, at(10))).toEqual({ item: program[1], live: false });
    expect(nextProgramItem(program, at(15))).toEqual({ item: program[1], live: true });
    // Ends are exclusive: at 16:00 dinner is on, not the ceremony.
    expect(nextProgramItem(program, at(16))).toEqual({ item: program[2], live: true });
    expect(nextProgramItem(program, at(22))).toEqual({ item: program[0], live: true });
  });
  it('is nothing once everything is over, or with no program', () => {
    expect(nextProgramItem(program, at(23))).toBeNull();
    expect(nextProgramItem([], at(1))).toBeNull();
  });
});

describe('guestPassContent (M4.7a)', () => {
  const base = {
    serial: guestPassSerial('0190f1a2-0000-7000-8000-000000000001'),
    eventName: 'Ana & Luis',
    partyName: 'The Garcia family',
    timezone: 'America/Chicago',
    startsAt: at(14),
    endsAt: at(23),
    program: [item('Reception', 18, 24, 'Ballroom'), item('Ceremony', 15, 16, 'The garden')],
    seats: [{ itemLabel: '4', seatLabel: '2' }],
  };
  it('is relevant from the first part the party is invited to, there, until the last one ends', () => {
    const c = guestPassContent(base);
    expect(c.serial).toBe('yyg-0190f1a2-0000-7000-8000-000000000001');
    expect(c.relevantAt).toEqual(at(15));
    expect(c.place).toBe('The garden');
    expect(c.expiresAt).toEqual(at(24));
    expect(c.seats).toEqual([{ table: '4', seat: '2' }]);
    expect(c.moreSeats).toBe(0);
  });
  it('falls back to the event without a program, and has no place', () => {
    const c = guestPassContent({ ...base, program: [], seats: [] });
    expect(c.relevantAt).toEqual(at(14));
    expect(c.expiresAt).toEqual(at(23));
    expect(c.place).toBeNull();
    expect(c.seats).toEqual([]);
  });
  it('clips long text and caps the seats, counting the rest', () => {
    const long = 'x'.repeat(200);
    const seats = Array.from({ length: PASS_SEATS_MAX + 3 }, (_, i) => ({ itemLabel: long, seatLabel: `${i}` }));
    const c = guestPassContent({ ...base, eventName: long, partyName: long, seats });
    expect(c.eventName).toHaveLength(PASS_TEXT_MAX);
    expect(c.eventName.endsWith('…')).toBe(true);
    expect(c.partyName).toHaveLength(PASS_TEXT_MAX);
    expect(c.seats).toHaveLength(PASS_SEATS_MAX);
    expect(c.seats[0]?.table).toHaveLength(24);
    expect(c.moreSeats).toBe(3);
  });
});

describe('fake guest pass provider (M4.7a)', () => {
  it('records each issue and returns a JSON stand-in with only the pass fields', async () => {
    const p = fakeGuestPassProvider();
    const content = guestPassContent({
      serial: 'yyg-1',
      eventName: 'Gala',
      partyName: 'Acme Corp',
      timezone: 'UTC',
      startsAt: at(18),
      endsAt: at(23),
      program: [],
      seats: Array.from({ length: PASS_SEATS_MAX + 1 }, (_, i) => ({ itemLabel: 'T1', seatLabel: `${i + 1}` })),
    });
    const r = await p.issuePass({
      platform: 'google',
      content,
      barcode: 'https://app.test/hub/abc',
      locale: 'fr',
      labels: { party: 'Groupe', when: 'Quand', place: 'Où', seats: 'Places' },
      when: '1 juin 2030',
    });
    expect(p.issued).toEqual([{ platform: 'google', serial: 'yyg-1', barcode: 'https://app.test/hub/abc' }]);
    if (r.kind !== 'file') throw new Error('expected a file');
    expect(r.contentType).toBe(FAKE_PASS_CONTENT_TYPE);
    expect(r.filename).toBe('yyg-1-google.json');
    const body = JSON.parse(r.body);
    expect(body.locale).toBe('fr');
    // No place without a program; seats capped with "+1".
    expect(body.fields.map((f: { key: string }) => f.key)).toEqual(['party', 'when', 'seats']);
    expect(body.fields[2].value).toBe('T1 · 1, T1 · 2, T1 · 3, T1 · 4, T1 · 5, T1 · 6, +1');
  });
});
