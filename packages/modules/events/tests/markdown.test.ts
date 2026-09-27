import { describe, expect, it } from 'vitest';
import {
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  safeHref,
  sanitizeMarkdown,
} from '../src/domain/markdown.ts';

describe('markdown sanitizer (M1.4d)', () => {
  it('keeps raw HTML as literal text, never as markup', () => {
    const doc = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(doc).toEqual([
      { t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] },
      { t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] },
    ]);
  });

  it('drops unsafe link targets and keeps the text', () => {
    // The link target stops at the first ')' as in CommonMark; either way no link survives.
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ t: 'text', v: 'click)' }]);
    expect(parseInline('[x](data:text/html;base64,AAAA)')).toEqual([{ t: 'text', v: 'x' }]);
    expect(parseInline('[rel](/admin)')).toEqual([{ t: 'text', v: 'rel' }]);
    expect(parseInline('[site](https://example.com/a?b=1)')).toEqual([
      { t: 'link', href: 'https://example.com/a?b=1', c: [{ t: 'text', v: 'site' }] },
    ]);
    expect(safeHref('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('vbscript:x')).toBeNull();
  });

  it('parses headings, lists, emphasis and code', () => {
    const doc = parseMarkdown(
      '## Parking\nUse **lot B** or *lot C*.\n\n- one\n- `two`\n\n1. first\n2. second',
    );
    expect(doc).toEqual([
      { t: 'h', level: 2, c: [{ t: 'text', v: 'Parking' }] },
      {
        t: 'p',
        c: [
          { t: 'text', v: 'Use ' },
          { t: 'strong', c: [{ t: 'text', v: 'lot B' }] },
          { t: 'text', v: ' or ' },
          { t: 'em', c: [{ t: 'text', v: 'lot C' }] },
          { t: 'text', v: '.' },
        ],
      },
      { t: 'ul', items: [[{ t: 'text', v: 'one' }], [{ t: 'code', v: 'two' }]] },
      { t: 'ol', items: [[{ t: 'text', v: 'first' }], [{ t: 'text', v: 'second' }]] },
    ]);
  });

  it('does not treat snake_case as emphasis', () => {
    expect(parseInline('use wifi_guest_5g')).toEqual([{ t: 'text', v: 'use wifi_guest_5g' }]);
  });

  it('strips control and bidi-override characters, normalizes newlines and caps length', () => {
    expect(sanitizeMarkdown('a\u0000b‮c\r\nd\te ')).toBe('abc\nd\te');
    expect(sanitizeMarkdown('x'.repeat(20), 5)).toBe('xxxxx');
  });

  it('gives plain text for previews', () => {
    expect(markdownToPlainText('## Hi\n**bold** [link](https://a.b)')).toBe('Hi bold link');
  });
});
