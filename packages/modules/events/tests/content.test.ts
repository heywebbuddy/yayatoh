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
    expect(parseScheduleText(formatScheduleText({ items }))).toEqual(items);
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
