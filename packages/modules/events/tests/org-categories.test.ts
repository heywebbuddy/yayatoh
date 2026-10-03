import { describe, expect, it } from 'vitest';
import {
  CategoryNameError,
  categoryRef,
  isPlatformKey,
  MAX_CATEGORY_NAME,
  moveInOrder,
  normalizeCategoryName,
} from '../src/domain/org-categories.ts';

describe('org categories (U8)', () => {
  it('a category is addressed by its platform key while an unchanged default, else by id', () => {
    const id = '0190a1b2-0000-7000-8000-000000000001';
    expect(categoryRef({ id, name: null, platformKey: 'music' })).toBe('music');
    expect(categoryRef({ id, name: 'Live music', platformKey: 'music' })).toBe(id);
    expect(isPlatformKey('music')).toBe(true);
    expect(isPlatformKey(id)).toBe(false);
    expect(isPlatformKey('Music')).toBe(false);
  });

  it('names are trimmed with inner whitespace collapsed; empty is null; too long throws', () => {
    expect(normalizeCategoryName('  Family   days ')).toBe('Family days');
    expect(normalizeCategoryName('   ')).toBeNull();
    expect(normalizeCategoryName('x'.repeat(MAX_CATEGORY_NAME))).toHaveLength(MAX_CATEGORY_NAME);
    expect(() => normalizeCategoryName('x'.repeat(MAX_CATEGORY_NAME + 1))).toThrow(CategoryNameError);
  });

  it('moves one step up or down; the ends and unknown ids leave the order alone', () => {
    const order = ['a', 'b', 'c'];
    expect(moveInOrder(order, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(order, 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(order, 'a', 'up')).toEqual(order);
    expect(moveInOrder(order, 'c', 'down')).toEqual(order);
    expect(moveInOrder(order, 'z', 'up')).toEqual(order);
    // The input is never mutated.
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
