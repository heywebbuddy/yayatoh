import { describe, expect, it } from 'vitest';
import { parseTags, TagError, tagKey } from '../src/domain/categories.ts';
import {
  formatFaqText,
  formatLinksText,
  formatScheduleText,
  parseFaqText,
  parseLinksText,
  parseScheduleText,
  SectionBody,
  SectionTextError,
} from '../src/domain/sections.ts';
import { parseVideoUrl, videoEmbedUrl } from '../src/domain/video.ts';

describe('section text formats (M1.4d)', () => {
  it('parses FAQ blocks and round-trips', () => {
    const items = parseFaqText('Is there parking?\nYes, lot B.\n\nQ: Kids?\nA: Under 12 free.\n');
    expect(items).toEqual([
      { question: 'Is there parking?', answer: 'Yes, lot B.' },
      { question: 'Kids?', answer: 'Under 12 free.' },
    ]);
    expect(parseFaqText(formatFaqText({ items }))).toEqual(items);
    expect(() => parseFaqText('A question only')).toThrow(SectionTextError);
  });

  it('parses schedule lines, normalizing times', () => {
    const items = parseScheduleText('9:00 | Doors\n18.30 | Dinner | Main hall\n\n');
    expect(items).toEqual([
      { time: '09:00', title: 'Doors', detail: null },
      { time: '18:30', title: 'Dinner', detail: 'Main hall' },
    ]);
    expect(parseScheduleText(formatScheduleText({ items: items.map((i) => ({ ...i, day: null })) }))).toEqual(items);
    expect(() => parseScheduleText('25:00 | Late')).toThrow(
      expect.objectContaining({ reason: 'schedule_time', line: 1 }),
    );
    expect(() => parseScheduleText('09:00 | ok\nno pipe')).toThrow(
      expect.objectContaining({ reason: 'schedule_line', line: 2 }),
    );
  });

  it('parses links and refuses unsafe ones', () => {
    const items = parseLinksText('Tickets | https://example.com/t\nMap | http://maps.example.com');
    expect(items).toHaveLength(2);
    expect(parseLinksText(formatLinksText({ items }))).toEqual(items);
    expect(() => parseLinksText('Bad | javascript:alert(1)')).toThrow(
      expect.objectContaining({ reason: 'links_url' }),
    );
    expect(() => parseLinksText('no url here')).toThrow(expect.objectContaining({ reason: 'links_line' }));
  });

  it('validates section bodies per kind', () => {
    expect(SectionBody.safeParse({ kind: 'text', content: { markdown: '  hi  ' } }).data).toEqual({
      kind: 'text',
      content: { markdown: 'hi' },
    });
    expect(SectionBody.safeParse({ kind: 'text', content: { markdown: '   ' } }).success).toBe(false);
    expect(SectionBody.safeParse({ kind: 'faq', content: { items: [] } }).success).toBe(false);
    expect(SectionBody.safeParse({ kind: 'location', content: {} }).success).toBe(false);
    expect(
      SectionBody.safeParse({ kind: 'location', content: { address: '1 Main St', mapUrl: 'javascript:x' } })
        .success,
    ).toBe(false);
    expect(SectionBody.safeParse({ kind: 'nope', content: {} }).success).toBe(false);
  });
});

describe('tags (M1.4c)', () => {
  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseTags(' Jazz ,  jazz, Live   Music,,')).toEqual(['Jazz', 'Live Music']);
    expect(tagKey('  Live  MUSIC ')).toBe('live music');
  });
  it('limits tag length and count', () => {
    expect(() => parseTags(['x'.repeat(41)])).toThrow(TagError);
    expect(() => parseTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow(TagError);
  });
});

describe('structured section content (U-editor)', () => {
  it('accepts untimed schedule rows with day headings, and old stored rows', () => {
    const parsed = SectionBody.parse({
      kind: 'schedule',
      content: {
        items: [
          { time: '09:00', title: 'Doors' },
          { time: null, title: 'JOUR 2 : conférence', day: 'Jour 2' },
        ],
      },
    });
    expect(parsed.kind === 'schedule' && parsed.content.items.map((i) => [i.time, i.day])).toEqual([
      ['09:00', null],
      [null, 'Jour 2'],
    ]);
    expect(() =>
      SectionBody.parse({ kind: 'schedule', content: { items: [{ time: '25:00', title: 'x' }] } }),
    ).toThrow();
  });

  it('only embeds YouTube and Vimeo links', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')?.id).toBe('dQw4w9WgXcQ');
    expect(parseVideoUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', id: '76979871' });
    expect(parseVideoUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoUrl('javascript:alert(1)')).toBeNull();
    const ref = parseVideoUrl('https://vimeo.com/76979871');
    expect(ref && videoEmbedUrl(ref)).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(
      SectionBody.safeParse({ kind: 'video', content: { url: 'https://example.com/v.mp4' } }).success,
    ).toBe(false);
    expect(
      SectionBody.safeParse({ kind: 'video', content: { url: 'https://youtu.be/dQw4w9WgXcQ' } }).success,
    ).toBe(true);
  });
});
