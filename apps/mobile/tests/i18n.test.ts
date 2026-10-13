import { catalogs, DEFAULT_LOCALE, LOCALES, pickLocale } from '../src/i18n';

const flatten = (value: unknown, prefix = ''): string[] =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => flatten(v, `${prefix}${k}.`))
    : [prefix.slice(0, -1)];

describe('catalogs', () => {
  it('has the 13 web locales', () => {
    expect([...LOCALES].sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'nl', 'pt', 'ru', 'zh-CN', 'zh-TW'].sort(),
    );
  });

  it('gives every locale exactly the English keys, with no empty string', () => {
    const keys = flatten(catalogs.en).sort();
    for (const locale of LOCALES) {
      expect(flatten(catalogs[locale]).sort()).toEqual(keys);
      for (const key of keys) {
        const value = key
          .split('.')
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], catalogs[locale]);
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
      }
    }
  });
});

describe('pickLocale', () => {
  it.each([
    ['en-US', 'en'],
    ['pt-BR', 'pt'],
    ['ar_EG', 'ar'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['sv-SE', DEFAULT_LOCALE],
    ['', DEFAULT_LOCALE],
    [undefined, DEFAULT_LOCALE],
  ])('%s -> %s', (tag, expected) => {
    expect(pickLocale(tag)).toBe(expected);
  });
});
