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
    const d = parseEventDesign({ theme: 'classic', heroLayout: 'circle' });
    expect(d).toEqual({
      theme: 'classic',
      headingFont: 'modern',
      heroLayout: 'circle',
      heroVideoUrl: null,
      heroVideoPoster: null,
      assistant: false,
    });
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

  it('accepts an uploaded video and its poster, and nothing else under /video', () => {
    const id = '0190c0de-0000-7000-8000-000000000001';
    const hash = 'a'.repeat(32);
    const ok = {
      heroVideoUrl: `/video/${id}/${id}/v-${hash}.mp4`,
      heroVideoPoster: `/video/${id}/${id}/p-${hash}.jpg`,
    };
    expect(EventDesign.safeParse(ok).success).toBe(true);
    expect(EventDesign.safeParse({ ...ok, heroVideoUrl: `/video/${id}/${id}/v-${hash}.exe` }).success).toBe(
      false,
    );
    expect(EventDesign.safeParse({ ...ok, heroVideoPoster: 'https://evil.test/p.jpg' }).success).toBe(false);
  });

  it('knows the default, so it is stored as null', () => {
    expect(isDefaultDesign(DEFAULT_EVENT_DESIGN)).toBe(true);
    expect(isDefaultDesign({ ...DEFAULT_EVENT_DESIGN, theme: 'classic' })).toBe(false);
  });
});
