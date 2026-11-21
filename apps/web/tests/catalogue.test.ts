import { readFileSync } from 'node:fs';
import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_LOCALES, catalogue } from '../src/i18n/catalogue.ts';

describe('client message catalogues', () => {
  it('has a catalogue file for every locale the routing serves, and no other', () => {
    expect([...CATALOGUE_LOCALES].sort()).toEqual([...LOCALES].sort());
  });

  it('loads the same messages the server reads for a locale', async () => {
    const onDisk = JSON.parse(readFileSync(new URL('../messages/fr.json', import.meta.url), 'utf8'));
    expect(await catalogue('fr')).toEqual(onDisk);
  });

  it('loads each locale once and falls back to the default locale', async () => {
    expect(catalogue('de')).toBe(catalogue('de'));
    expect(await catalogue('xx')).toBe(await catalogue('en'));
  });
});
