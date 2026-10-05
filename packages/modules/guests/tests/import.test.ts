import { describe, expect, it } from 'vitest';
import {
  type GroupContext,
  groupGuestRows,
  guessGuestMapping,
  type MappedGuestRow,
  mapGuestRow,
  parseAgeClass,
  parseSheetUrl,
  plusOneMarker,
  sheetExportUrl,
  splitName,
} from '../src/domain/import.ts';

const CTX: GroupContext = {
  existingPartyNames: [],
  existing: { parties: 0, guests: 0 },
  limits: { maxGuestsPerParty: 20, maxPartiesPerEvent: 1000, maxGuestsPerEvent: 3000 },
};

const HEADERS = ['Household', 'First name', 'Last name', 'Age', 'Meal', 'Side', 'VIP', 'Tags', 'Plus one'];
const M = guessGuestMapping(HEADERS);
const rows = (cells: string[][]): MappedGuestRow[] => cells.map((c, i) => mapGuestRow(i + 1, c, M));

describe('guessGuestMapping (M4.1b)', () => {
  it('maps English wedding-sheet headers', () => {
    expect(M).toEqual({
      party: 0,
      firstName: 1,
      lastName: 2,
      ageClass: 3,
      meal: 4,
      side: 5,
      vip: 6,
      tags: 7,
      plusOne: 8,
    });
    expect(
      guessGuestMapping([
        'Guest name',
        'E-mail address',
        'Mobile phone',
        'Dietary restrictions',
        'Wheelchair / access needs',
        'Mailing address',
        'Family',
      ]),
    ).toEqual({ fullName: 0, email: 1, phone: 2, dietary: 3, accessibility: 4, address: 5, party: 6 });
  });

  it('maps headers in other languages', () => {
    expect(
      guessGuestMapping(['Familia', 'Nombre', 'Apellido', 'Edad', 'Alergias', 'Correo electrónico']),
    ).toEqual({ party: 0, firstName: 1, lastName: 2, ageClass: 3, dietary: 4, email: 5 });
    expect(guessGuestMapping(['Famille', 'Prénom', 'Nom', 'Téléphone', 'Adresse', 'Accompagnateur'])).toEqual(
      {
        party: 0,
        firstName: 1,
        lastName: 2,
        phone: 3,
        address: 4,
        plusOne: 5,
      },
    );
    expect(guessGuestMapping(['Vorname', 'Nachname', 'Haushalt', 'Diät', 'Begleitung'])).toMatchObject({
      firstName: 0,
      lastName: 1,
      dietary: 3,
      plusOne: 4,
    });
    expect(guessGuestMapping(['姓', '名', 'メールアドレス', 'アレルギー', '家族'])).toEqual({
      lastName: 0,
      firstName: 1,
      email: 2,
      dietary: 3,
      party: 4,
    });
    expect(guessGuestMapping(['姓名', '电话', '地址', '家庭'])).toEqual({
      fullName: 0,
      phone: 1,
      address: 2,
      party: 3,
    });
    expect(guessGuestMapping(['العائلة', 'الاسم', 'البريد الإلكتروني', 'الهاتف'])).toEqual({
      party: 0,
      fullName: 1,
      email: 2,
      phone: 3,
    });
    expect(guessGuestMapping(['Фамилия', 'Имя', 'Семья', 'Телефон'])).toEqual({
      lastName: 0,
      firstName: 1,
      party: 2,
      phone: 3,
    });
    // "family name" is a last name, never a household; each column maps once.
    expect(guessGuestMapping(['Family name', 'Given name'])).toEqual({ lastName: 0, firstName: 1 });
    expect(guessGuestMapping(['Name', 'Name'])).toEqual({ fullName: 0 });
    expect(guessGuestMapping(['Notes', ''])).toEqual({});
  });
});

describe('values (M4.1b)', () => {
  it('reads age classes in words and years', () => {
    expect(parseAgeClass('')).toBe('adult');
    expect(parseAgeClass('Child')).toBe('child');
    expect(parseAgeClass('niño')).toBe('child');
    expect(parseAgeClass('Bébé')).toBe('infant');
    expect(parseAgeClass('子供')).toBe('child');
    expect(parseAgeClass('1')).toBe('infant');
    expect(parseAgeClass('7')).toBe('child');
    expect(parseAgeClass('34')).toBe('adult');
    expect(parseAgeClass('teenager')).toBeNull();
  });

  it('splits names and spots plus-one markers', () => {
    expect(splitName('Luis  Garcia')).toEqual({ first: 'Luis', last: 'Garcia' });
    expect(splitName('Garcia, Luis')).toEqual({ first: 'Luis', last: 'Garcia' });
    expect(splitName('Mary Ann Smith')).toEqual({ first: 'Mary Ann', last: 'Smith' });
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: null });
    expect(plusOneMarker('+1')).toBe('');
    expect(plusOneMarker('Plus-one')).toBe('');
    expect(plusOneMarker('Guest of Luis')).toBe('Luis');
    expect(plusOneMarker('Invitado de Ana')).toBe('Ana');
    expect(plusOneMarker('invitée de Zoé')).toBe('Zoé');
    expect(plusOneMarker('Luis Garcia')).toBeNull();
    expect(plusOneMarker('Guestina Smith')).toBeNull();
  });

  it('maps a row and names its first problem', () => {
    const r = mapGuestRow(
      1,
      ['The Garcias', ' Luis ', 'Garcia', 'adult', 'Beef', 'Bride', 'yes', 'Family; Out of town', 'yes'],
      M,
    );
    expect(r).toMatchObject({
      household: 'The Garcias',
      firstName: 'Luis',
      lastName: 'Garcia',
      ageClass: 'adult',
      vip: true,
      tags: ['Family', 'Out of town'],
      plusOne: 'unnamed',
      error: null,
    });
    expect(mapGuestRow(2, ['X', '', 'Garcia'], M).error).toBe('missing_name');
    expect(mapGuestRow(2, ['X', 'Al', '', 'teen'], M).error).toBe('invalid_age');
    expect(mapGuestRow(2, ['X', 'A'.repeat(81)], M).error).toBe('name_too_long');
    expect(mapGuestRow(2, ['X', 'Al', '', '', 'M'.repeat(81)], M).error).toBe('value_too_long');
    expect(
      mapGuestRow(
        2,
        ['X', 'Al', '', '', '', '', '', Array.from({ length: 21 }, (_, i) => `t${i}`).join(',')],
        M,
      ).error,
    ).toBe('too_many_tags');
    const m2 = guessGuestMapping(['Name', 'Email', 'Phone', 'Plus one']);
    expect(mapGuestRow(3, ['Al Bo', 'not-an-email', '', ''], m2).error).toBe('invalid_email');
    expect(mapGuestRow(3, ['Al Bo', '', 'call me', ''], m2).error).toBe('invalid_phone');
    expect(mapGuestRow(3, ['Al Bo', 'al@x.test', '+1 (555) 010-2000', 'Jamie Lee'], m2)).toMatchObject({
      firstName: 'Al',
      lastName: 'Bo',
      email: 'al@x.test',
      phone: '+1 (555) 010-2000',
      plusOne: { firstName: 'Jamie', lastName: 'Lee' },
      error: null,
    });
    expect(mapGuestRow(3, ['Al Bo', '', '', 'no'], m2).plusOne).toBeNull();
  });
});

describe('groupGuestRows (M4.1b)', () => {
  it('groups by household; rows without one are a party of one; plus-ones follow their host', () => {
    const r = groupGuestRows(
      rows([
        ['The Garcias', 'Luis', 'Garcia', '', 'Beef', 'Bride', 'yes', 'Family', 'yes'],
        ['the  garcias', 'Sofi', 'Garcia', 'child', '', '', '', 'Kids'],
        ['', 'Ana', 'Kim', '', '', 'Groom'],
        ['The Garcias', 'Marta', 'Garcia'],
        ['The Garcias', 'Guest of Marta'],
      ]),
      CTX,
    );
    expect(r.rejected.size).toBe(0);
    expect(r.parties.map((p) => [p.name, p.rowNos, p.side, p.vip, p.tags])).toEqual([
      ['The Garcias', [1, 2, 4, 5], 'Bride', true, ['Family', 'Kids']],
      ['Ana Kim', [3], 'Groom', false, []],
    ]);
    const g = r.parties[0]?.guests ?? [];
    expect(g.map((x) => [x.kind, x.firstName, x.host])).toEqual([
      ['guest', 'Luis', null],
      ['plus_one', null, 0],
      ['guest', 'Sofi', null],
      ['guest', 'Marta', null],
      ['plus_one', null, 3],
    ]);
    expect(g[2]?.ageClass).toBe('child');
  });

  it('a "+1" row belongs to the guest above it; without one it is rejected with its party', () => {
    const r = groupGuestRows(
      rows([
        ['Lees', 'Jo', 'Lee'],
        ['Lees', '+1'],
        ['Lees', 'Plus one'],
        ['', '+1'],
      ]),
      CTX,
    );
    // Jo already has a plus-one, so the second marker has no one to attach to: the Lees are
    // rejected whole, and the lone "+1" too.
    expect(r.parties).toEqual([]);
    expect(Object.fromEntries(r.rejected)).toEqual({
      1: 'party_has_errors',
      2: 'party_has_errors',
      3: 'plus_one_without_guest',
      4: 'plus_one_without_guest',
    });
  });

  it('rejects the whole party on any bad row, over the party limit, on a name clash or a full event', () => {
    const big = Array.from({ length: 11 }, (_, i) => ['Big', `G${i}`, 'X', '', '', '', '', '', 'yes']);
    const r = groupGuestRows(
      rows([
        ['Bad', 'Al', 'A'],
        ['Bad', 'Bo', 'B', 'teen'],
        ...big,
        ['', 'Old', 'Party'],
        ['Fine', 'Cy', 'C'],
        ['Fine', 'Cy', 'C'],
        ['', 'Dee', 'D'],
        ['', 'dee  d'],
        ['Last', 'Ed', 'E'],
      ]),
      { ...CTX, existingPartyNames: ['OLD PARTY'], existing: { parties: 998, guests: 10 } },
    );
    const codes = Object.fromEntries(r.rejected);
    expect(codes[1]).toBe('party_has_errors');
    expect(codes[2]).toBe('invalid_age');
    expect(new Set(big.map((_, i) => codes[i + 3]))).toEqual(new Set(['party_too_large']));
    expect(codes[14]).toBe('party_exists');
    expect(codes[16]).toBe('duplicate_in_file');
    expect(codes[15]).toBe('party_has_errors');
    expect(codes[18]).toBe('duplicate_in_file');
    // 998 parties exist: "Dee D" makes 999, "Last" 1000; nothing else fits.
    expect(r.parties.map((p) => p.name)).toEqual(['Dee D', 'Last']);
    const full = groupGuestRows(rows([['', 'Zed', 'Z']]), {
      ...CTX,
      existing: { parties: 1, guests: 3000 },
    });
    expect([...full.rejected]).toEqual([[1, 'event_full']]);
  });

  it('twenty guests including plus-ones fit; twenty-one do not', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ['Ten', `G${i}`, 'X', '', '', '', '', '', 'yes']);
    expect(groupGuestRows(rows(ten), CTX).parties[0]?.guests).toHaveLength(20);
    const r = groupGuestRows(rows([...ten, ['Ten', 'One', 'More']]), CTX);
    expect(r.parties).toEqual([]);
    expect(r.rejected.size).toBe(11);
  });
});

describe('Google Sheet links (P4-7)', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
  it('accepts only docs.google.com/spreadsheets/d/<id> over https', () => {
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`)).toEqual({
      id: ID,
      gid: '123',
    });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toEqual({
      id: ID,
      gid: null,
    });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}?gid=7`)).toEqual({ id: ID, gid: '7' });
    for (const bad of [
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.evil.test/spreadsheets/d/${ID}/edit`,
      `https://evil.test/spreadsheets/d/${ID}/edit`,
      `https://drive.google.com/file/d/${ID}/view`,
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://docs.google.com/spreadsheets/d/e/2PACX-${ID}/pubhtml`,
      `https://user:pw@docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com:8443/spreadsheets/d/${ID}/edit`,
      'https://docs.google.com/spreadsheets/d/short/edit',
      'not a url',
      'https://127.0.0.1/spreadsheets/d/x',
    ])
      expect(parseSheetUrl(bad), bad).toBeNull();
  });

  it('builds the CSV export link of the tab', () => {
    expect(sheetExportUrl({ id: ID, gid: '5' })).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=5`,
    );
    expect(sheetExportUrl({ id: ID, gid: null })).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`,
    );
  });
});
