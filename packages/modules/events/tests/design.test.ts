import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_DESIGN,
  EventDesign,
  isDefaultDesign,
  parseEventDesign,
} from '../src/domain/design.ts';

describe('event design options', () => {
  it('reads nothing, junk and old rows as the classic default', () => {
    expect(parseEventDesign(null)).toEqual(DEFAULT_EVENT_DESIGN);
    expect(parseEventDesign('not json')).toEqual(DEFAULT_EVENT_DESIGN);
    expect(parseEventDesign({ theme: 'neon' })).toEqual(DEFAULT_EVENT_DESIGN);
    expect(parseEventDesign({})).toEqual(DEFAULT_EVENT_DESIGN);
  });

  it('keeps a valid design and fills what is missing', () => {
    const d = parseEventDesign({ theme: 'showcase', heroLayout: 'circle' });
    expect(d).toEqual({ theme: 'showcase', headingFont: 'modern', heroLayout: 'circle', heroVideoUrl: null });
    expect(parseEventDesign(JSON.stringify(d))).toEqual(d);
  });

  it('only takes https links for the hero video', () => {
    const base = { theme: 'showcase', headingFont: 'extended', heroLayout: 'video' };
    expect(EventDesign.safeParse({ ...base, heroVideoUrl: 'https://youtu.be/dQw4w9WgXcQ' }).success).toBe(
      true,
    );
    expect(EventDesign.safeParse({ ...base, heroVideoUrl: 'http://youtu.be/dQw4w9WgXcQ' }).success).toBe(
      false,
    );
    expect(EventDesign.safeParse({ ...base, heroVideoUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('knows the default, so it is stored as null', () => {
    expect(isDefaultDesign(DEFAULT_EVENT_DESIGN)).toBe(true);
    expect(isDefaultDesign({ ...DEFAULT_EVENT_DESIGN, theme: 'showcase' })).toBe(false);
  });
});
