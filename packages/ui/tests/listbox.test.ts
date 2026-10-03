import { describe, expect, it } from 'vitest';
import {
  AUTO_SEARCH_ABOVE,
  filterOptions,
  initialValue,
  type ListOption,
  moveActive,
  normalize,
  typeahead,
} from '../src/components/listbox.ts';

const opts = (labels: string[], disabled: number[] = []): ListOption[] =>
  labels.map((l, i) => ({ value: `v${i}`, label: l, text: l, disabled: disabled.includes(i) }));

describe('moveActive (WAI-ARIA listbox keys)', () => {
  const list = opts(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'], [1]);
  it('ArrowDown and ArrowUp skip disabled options and stop at the ends', () => {
    expect(moveActive(list, 0, 'ArrowDown')).toBe(2);
    expect(moveActive(list, 2, 'ArrowUp')).toBe(0);
    expect(moveActive(list, 0, 'ArrowUp')).toBe(0);
    expect(moveActive(list, 11, 'ArrowDown')).toBe(11);
  });
  it('Home and End jump to the first and last enabled options', () => {
    expect(moveActive(list, 5, 'Home')).toBe(0);
    expect(moveActive(list, 5, 'End')).toBe(11);
    expect(moveActive(opts(['A', 'B'], [0]), 1, 'Home')).toBe(1);
  });
  it('PageDown and PageUp move by ten, clamped', () => {
    expect(moveActive(list, 0, 'PageDown')).toBe(10);
    expect(moveActive(list, 10, 'PageDown')).toBe(11);
    expect(moveActive(list, 11, 'PageUp')).toBe(2);
    expect(moveActive(list, 3, 'PageUp')).toBe(0);
  });
  it('with nothing active, ArrowDown starts at the first and ArrowUp at the last', () => {
    expect(moveActive(list, -1, 'ArrowDown')).toBe(0);
    expect(moveActive(list, -1, 'ArrowUp')).toBe(11);
  });
  it('an empty list has no active option', () => {
    expect(moveActive([], 0, 'ArrowDown')).toBe(-1);
  });
});

describe('typeahead', () => {
  const list = opts(['Apple', 'Banana', 'Blueberry', 'Cherry', 'Ålesund']);
  it('finds the next option starting with the typed prefix, after the current one', () => {
    expect(typeahead(list, 'b', 0)).toBe(1);
    expect(typeahead(list, 'b', 1)).toBe(2);
    expect(typeahead(list, 'b', 2)).toBe(1);
    expect(typeahead(list, 'bl', 1)).toBe(2);
  });
  it('ignores case and accents', () => {
    expect(typeahead(list, 'AL', 0)).toBe(4);
  });
  it('a repeated single letter cycles through matches', () => {
    expect(typeahead(list, 'bb', 1)).toBe(2);
  });
  it('returns -1 when nothing matches', () => {
    expect(typeahead(list, 'z', 0)).toBe(-1);
  });
});

describe('filterOptions', () => {
  const list = opts(['New York', 'Newark', 'São Paulo', 'Amsterdam']);
  it('matches words anywhere, ignoring case and accents', () => {
    expect(filterOptions(list, 'york').map((o) => o.text)).toEqual(['New York']);
    expect(filterOptions(list, 'sao').map((o) => o.text)).toEqual(['São Paulo']);
    expect(filterOptions(list, '  ').length).toBe(4);
  });
  it('also matches the value and extra keywords', () => {
    const l = [{ value: 'EUR', label: 'Euro', text: 'Euro', keywords: '€' }];
    expect(filterOptions(l, 'eur').length).toBe(1);
    expect(filterOptions(l, '€').length).toBe(1);
  });
  it('turns search on above eight options', () => {
    expect(AUTO_SEARCH_ABOVE).toBe(8);
  });
});

describe('initialValue (same submitted value as a native select)', () => {
  const list = opts(['A', 'B', 'C'], [0]);
  it('uses the given value, then the default, then the first enabled option', () => {
    expect(initialValue(list, 'v2', undefined)).toBe('v2');
    expect(initialValue(list, undefined, 'v1')).toBe('v1');
    expect(initialValue(list, undefined, undefined)).toBe('v1');
    expect(initialValue([], undefined, undefined)).toBe('');
  });
});

describe('normalize', () => {
  it('folds case and diacritics', () => {
    expect(normalize('Ça Va ÉTÉ')).toBe('ca va ete');
  });
});
