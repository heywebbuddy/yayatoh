import { describe, expect, it } from 'vitest';
import {
  findTicketHolders,
  lookupHash,
  lookupKind,
  type ManifestRow,
  nameMatches,
  phoneKey,
  phoneLookupHash,
} from '../src/index.ts';

const SALT = 'yy-manifest:event-1';
let n = 0;
const row = async (
  holderName: string,
  email: string,
  phone: string | null,
  over: Partial<ManifestRow> = {},
): Promise<ManifestRow> => {
  const phoneHash = phone ? await phoneLookupHash(SALT, phone) : null;
  return {
    ticketId: `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    shortCode: `SC${n}`,
    rev: 0,
    status: 'active',
    ticketTypeId: 'type-ga',
    typeName: 'General',
    accessDates: [],
    holderName,
    emailHash: await lookupHash(SALT, email),
    ...(phoneHash ? { phoneHash } : {}),
    issuedAt: '2027-11-01T00:00:00Z',
    ...over,
  };
};

describe('door lookup (agreement §8: name, phone and email)', () => {
  it('tells an email, a phone number and a name apart', () => {
    expect(lookupKind('  Ana@Example.com ')).toBe('email');
    expect(lookupKind('+1 (415) 555-0134')).toBe('phone');
    expect(lookupKind('4155550134')).toBe('phone');
    // Too few digits to be a phone number: searched as a name (short codes go to the code box).
    expect(lookupKind('5550')).toBe('name');
    expect(lookupKind('José')).toBe('name');
  });

  it('compares phone numbers by their last eight digits', () => {
    expect(phoneKey('+1 (415) 555-0134')).toBe('55550134');
    expect(phoneKey('415.555.0134')).toBe('55550134');
    expect(phoneKey('555-013')).toBeNull();
  });

  it('matches every word of a name at a word start, ignoring case and accents', () => {
    expect(nameMatches('José María Núñez', 'jose nun')).toBe(true);
    expect(nameMatches('José María Núñez', 'maria')).toBe(true);
    expect(nameMatches('José María Núñez', 'ose')).toBe(false);
    expect(nameMatches('José María Núñez', '  ')).toBe(false);
  });

  it('finds holders by email and phone hash, and by name, active passes first', async () => {
    const rows = [
      await row('Zoe Park', 'zoe@example.com', '+14155550134'),
      await row('Ana Lima', 'ana@example.com', null),
      await row('Ana Lima', 'ana@example.com', null, { status: 'void' }),
      await row('Anabel Cruz', 'anabel@example.com', '+447700900123'),
    ];
    const byEmail = await findTicketHolders(rows, SALT, ' ANA@example.com ');
    expect(byEmail.kind).toBe('email');
    expect(byEmail.rows.map((r) => [r.holderName, r.status])).toEqual([
      ['Ana Lima', 'active'],
      ['Ana Lima', 'void'],
    ]);
    const byPhone = await findTicketHolders(rows, SALT, '(415) 555-0134');
    expect(byPhone.kind).toBe('phone');
    expect(byPhone.rows.map((r) => r.holderName)).toEqual(['Zoe Park']);
    const byName = await findTicketHolders(rows, SALT, 'ana');
    expect(byName.rows.map((r) => r.holderName)).toEqual(['Ana Lima', 'Anabel Cruz', 'Ana Lima']);
    expect((await findTicketHolders(rows, SALT, 'a')).rows).toEqual([]);
    expect((await findTicketHolders(rows, SALT, 'nobody@example.com')).rows).toEqual([]);
  });

  it('never matches a phone query against a row without a number, and caps the results', async () => {
    const rows = await Promise.all(
      Array.from({ length: 30 }, (_, i) => row(`Guest ${i}`, `g${i}@x.io`, null)),
    );
    expect((await findTicketHolders(rows, SALT, '+1 415 555 0134')).rows).toEqual([]);
    expect((await findTicketHolders(rows, SALT, 'guest')).rows).toHaveLength(25);
    expect((await findTicketHolders(rows, SALT, 'guest', 5)).rows).toHaveLength(5);
  });
});
