import { describe, expect, it } from 'vitest';
import { AnswerError, checkAnswers, evaluate, FormDefinition, validLogic } from '../src/definition.ts';

const def = FormDefinition.parse({
  fields: [
    { key: 'attending_with_kids', type: 'checkbox', label: 'Bringing kids?' },
    {
      key: 'kids',
      type: 'count',
      label: 'How many kids?',
      required: true,
      max: 10,
      showIf: { '==': [{ var: 'attending_with_kids' }, true] },
    },
    {
      key: 'seating',
      type: 'select',
      label: 'Seating',
      options: [
        { value: 'seated', label: 'Seated' },
        { value: 'standing', label: 'Standing' },
      ],
    },
    {
      key: 'diet',
      type: 'multi_select',
      label: 'Diet',
      options: [
        { value: 'veg', label: 'Vegetarian' },
        { value: 'halal', label: 'Halal' },
      ],
    },
    { key: 'note', type: 'long_text', label: 'Anything else?' },
  ],
});

describe('form definitions', () => {
  it('rejects duplicate keys, options on text fields, and unsupported conditions', () => {
    expect(() =>
      FormDefinition.parse({
        fields: [
          { key: 'a', type: 'short_text', label: 'A' },
          { key: 'a', type: 'short_text', label: 'B' },
        ],
      }),
    ).toThrow();
    expect(() =>
      FormDefinition.parse({
        fields: [{ key: 'a', type: 'short_text', label: 'A', options: [{ value: 'x', label: 'X' }] }],
      }),
    ).toThrow();
    expect(validLogic({ '==': [{ var: 'a' }, 1] })).toBe(true);
    expect(validLogic({ method: ['constructor'] })).toBe(false);
    expect(validLogic({ var: '__proto__' })).toBe(false);
  });

  it('evaluates the JsonLogic subset', () => {
    expect(
      evaluate({ and: [{ '>': [{ var: 'n' }, 2] }, { in: [{ var: 's' }, ['a', 'b']] }] }, { n: 3, s: 'a' }),
    ).toBe(true);
    expect(evaluate({ '!': { var: 'x' } }, {})).toBe(true);
  });
});

describe('answers', () => {
  it('normalizes values and drops fields hidden by their condition', () => {
    expect(
      checkAnswers(def, { attending_with_kids: 'on', kids: '2', seating: 'seated', diet: ['veg', 'veg'] }),
    ).toEqual({
      attending_with_kids: true,
      kids: 2,
      seating: 'seated',
      diet: ['veg'],
    });
    // kids is required only when shown; hidden answers are discarded, not stored.
    expect(checkAnswers(def, { kids: '3' })).toEqual({});
  });

  it('names the field that is wrong', () => {
    const fieldOf = (a: Record<string, unknown>) => {
      try {
        checkAnswers(def, a);
      } catch (e) {
        return e instanceof AnswerError ? e.field : 'other';
      }
      return null;
    };
    expect(fieldOf({ attending_with_kids: true })).toBe('kids');
    expect(fieldOf({ attending_with_kids: true, kids: 11 })).toBe('kids');
    expect(fieldOf({ attending_with_kids: true, kids: 1.5 })).toBe('kids');
    expect(fieldOf({ seating: 'balcony' })).toBe('seating');
    expect(fieldOf({ nope: 1 })).toBe('nope');
    expect(fieldOf({ note: 'x'.repeat(2001) })).toBe('note');
  });
});
