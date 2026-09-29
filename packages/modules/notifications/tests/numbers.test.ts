import { describe, expect, it } from 'vitest';
import { countWords } from '../src/templates/numbers.ts';

describe('countWords (M3.2b alert copy)', () => {
  it('spells one to nine in languages without agreement from two up, digits from ten', () => {
    expect(countWords(3, 'en')).toBe('Three');
    expect(countWords(1, 'en')).toBe('One');
    expect(countWords(9, 'de')).toBe('Neun');
    expect(countWords(3, 'fr')).toBe('Trois');
    expect(countWords(3, 'hi')).toBe('तीन');
    expect(countWords(10, 'en')).toBe('10');
    expect(countWords(37, 'en')).toBe('37');
    expect(countWords(1200, 'en')).toBe('1,200');
  });
  it('uses digits where numerals agree in gender or case, and in Japanese and Chinese', () => {
    for (const l of ['ar', 'pt', 'ru', 'ja', 'zh-CN', 'zh-TW'])
      expect(countWords(3, l)).toBe(new Intl.NumberFormat(l).format(3));
    expect(countWords(0, 'en')).toBe('0');
  });
});
