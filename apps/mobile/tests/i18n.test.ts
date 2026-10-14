import { LOCALES } from '@yayatoh/mobile-core';
import { validateCatalogs } from '@yayatoh/mobile-core/catalog-check';
import { catalogs } from '../src/i18n';

describe('catalogs', () => {
  it('has the 13 web locales', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALES].sort());
  });

  it('gives every locale exactly the English keys, with valid ICU, the same placeholders and the plural forms its language needs', () => {
    expect(validateCatalogs(catalogs as never)).toEqual([]);
  });
});
