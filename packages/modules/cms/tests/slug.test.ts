import { parseMarkdown, sanitizeMarkdown } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import { cmsSlug, nextFreeSlug, SLUG_MAX, slugProblem } from '../src/domain/slug.ts';
import { BODY_MAX, CreateEntryInput, UpdateEntryInput } from '../src/dto.ts';

describe('CMS slug rules (M1.4g)', () => {
  it('derives a slug from the title: accents folded, punctuation to single hyphens', () => {
    expect(cmsSlug('Über uns — Café & Bühne!')).toBe('uber-uns-cafe-buhne');
    expect(cmsSlug('  Summer 2027: What’s New?  ')).toBe('summer-2027-what-s-new');
  });

  it('never derives an empty slug, and stays under the limit with room for a suffix', () => {
    expect(cmsSlug('!!!')).toBe('untitled');
    expect(cmsSlug('مرحبا بكم')).toBe('untitled');
    const long = cmsSlug('a'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX - 4);
    expect(slugProblem(`${long}-99`)).toBeNull();
  });

  it('names what is wrong with a typed slug', () => {
    expect(slugProblem('')).toBe('empty');
    expect(slugProblem('a'.repeat(81))).toBe('too_long');
    expect(slugProblem('a'.repeat(80))).toBeNull();
    for (const bad of ['Upper', '-lead', 'trail-', 'dou--ble', 'spa ce', 'ünï', 'a/b', 'a_b'])
      expect(slugProblem(bad), bad).toBe('format');
    for (const ok of ['a', 'about', 'faq-2027', '2027']) expect(slugProblem(ok), ok).toBeNull();
  });

  it('takes the next free suffix on a clash', () => {
    expect(nextFreeSlug('about', new Set())).toBe('about');
    expect(nextFreeSlug('about', new Set(['about']))).toBe('about-2');
    expect(nextFreeSlug('about', new Set(['about', 'about-2', 'about-3']))).toBe('about-4');
  });

  it('input schemas trim, lowercase the slug and turn blank optional text into null', () => {
    const v = CreateEntryInput.parse({ kind: 'post', title: '  Hi  ', slug: ' My-Post ', excerpt: '  ' });
    expect(v).toMatchObject({ title: 'Hi', slug: 'my-post', excerpt: null, body: '' });
    expect(CreateEntryInput.safeParse({ kind: 'post', title: '' }).success).toBe(false);
    expect(CreateEntryInput.safeParse({ kind: 'blog', title: 'x' }).success).toBe(false);
    expect(CreateEntryInput.safeParse({ kind: 'page', title: 'x', seoTitle: 'x'.repeat(71) }).success).toBe(
      false,
    );
    expect(UpdateEntryInput.parse({ entryId: '0190a4b8-0000-7000-8000-000000000000' })).toEqual({
      entryId: '0190a4b8-0000-7000-8000-000000000000',
    });
  });
});

describe('CMS bodies go through the M1.4d sanitizer', () => {
  it('strips control and bidi-override characters and caps the length on write', () => {
    const dirty = `Hello\u0000 ‮evil‬ world\r\nnext`;
    expect(sanitizeMarkdown(dirty, BODY_MAX)).toBe('Hello evil world\nnext');
    expect(sanitizeMarkdown('x'.repeat(BODY_MAX + 50), BODY_MAX)).toHaveLength(BODY_MAX);
  });

  it('renders raw HTML and script links as text, never markup', () => {
    const doc = parseMarkdown(
      '<script>alert(1)</script>\n\n[click](javascript:alert(1)) and [ok](https://example.com)',
    );
    expect(doc[0]).toEqual({ t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] });
    const second = doc[1];
    expect(second?.t).toBe('p');
    const nodes = second && 'c' in second ? second.c : [];
    expect(nodes.some((n) => n.t === 'link' && n.href.startsWith('javascript'))).toBe(false);
    expect(nodes).toContainEqual({ t: 'link', href: 'https://example.com/', c: [{ t: 'text', v: 'ok' }] });
  });
});
