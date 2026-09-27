import { reachable } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { eventLifecycle, slugify } from '../src/domain/lifecycle.ts';

describe('event lifecycle', () => {
  it('every state is reachable from draft and archived is terminal', () => {
    expect([...reachable(eventLifecycle)].sort()).toEqual([...eventLifecycle.states].sort());
    expect([...reachable(eventLifecycle, 'archived')]).toEqual(['archived']);
  });
  it('cannot publish a cancelled event or complete a draft', () => {
    expect(eventLifecycle.can('cancelled', 'publish')).toBe(false);
    expect(eventLifecycle.can('draft', 'complete')).toBe(false);
    expect(eventLifecycle.next('published', 'postpone')).toBe('postponed');
  });
});

describe('slugify', () => {
  it('makes URL-safe slugs', () => {
    expect(slugify('Midwest Leadership Summit 2027')).toBe('midwest-leadership-summit-2027');
    expect(slugify('Café & Crème — Gala!')).toBe('cafe-and-creme-gala');
    expect(slugify('ب')).toMatch(/^event/);
  });
});
