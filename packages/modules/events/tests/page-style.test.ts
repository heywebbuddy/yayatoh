import { describe, expect, it } from 'vitest';
import { parseEventDesign } from '../src/domain/design.ts';
import {
  contrast,
  contrastIssues,
  ensureContrast,
  isDefaultPageStyle,
  pageStyleVars,
  parsePageStyle,
  sanitizeHex,
  sectionOrder,
} from '../src/domain/page-style.ts';

describe('page style', () => {
  it('sanitizes colours to #rrggbb', () => {
    expect(sanitizeHex('#ABC')).toBe('#aabbcc');
    expect(sanitizeHex(' #1d5fd1 ')).toBe('#1d5fd1');
    expect(sanitizeHex('red')).toBeNull();
    expect(sanitizeHex('#12345g')).toBeNull();
    expect(sanitizeHex('#fff;background:url(x)')).toBeNull();
  });

  it('reads junk leniently and drops unknown or required-hidden sections', () => {
    const s = parsePageStyle({
      accent: 'javascript:alert(1)',
      scale: 'huge',
      order: ['agenda', 'agenda', 'nope'],
      hidden: ['passes', 'faq'],
    });
    expect(s.accent).toBeNull();
    expect(s.scale).toBe('default');
    expect(s.order).toEqual([]);
    expect(parsePageStyle({ order: ['agenda', 'agenda'], hidden: ['passes', 'faq'] })).toMatchObject({
      order: ['agenda'],
      hidden: ['faq'],
    });
    expect(isDefaultPageStyle(parsePageStyle(null))).toBe(true);
  });

  it('puts unplaced sections after the organizer order', () => {
    const order = sectionOrder(parsePageStyle({ order: ['faq', 'agenda'] }));
    expect(order.slice(0, 2)).toEqual(['faq', 'agenda']);
    expect(order).toContain('passes');
  });

  it('auto-corrects poor contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    const fixed = ensureContrast('#ffee00', '#ffffff');
    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const vars = pageStyleVars(
      parsePageStyle({ sectionBg: '#ffffff', text: '#dddddd', accent: '#ffee00', band: '#888888' }),
    );
    expect(contrast(vars['--ev-text-l'] as string, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--ev-accent-ink-l'] as string, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--ev-band'] as string, vars['--ev-band-ink'] as string)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(pageStyleVars(parsePageStyle({}))).toEqual({});
  });

  it('reports contrast issues for the warning', () => {
    const s = parsePageStyle({ sectionBg: '#ffffff', text: '#eeeeee' });
    expect(contrastIssues(s, { sectionBg: '#ffffff', text: '#111111' })).toEqual(['text']);
  });

  it('keeps the rest of the design when the page style is unreadable', () => {
    const d = parseEventDesign({ theme: 'classic', page: 'garbage' });
    expect(d.theme).toBe('classic');
    expect(d.page).toBeNull();
  });
});
