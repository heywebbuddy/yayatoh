import { parseMarkdown } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import {
  type BlogCard,
  categoriesOf,
  filterCards,
  headingsOf,
  readingMinutes,
} from '../src/components/blog/model.ts';

const card = (o: Partial<BlogCard>): BlogCard => ({
  slug: 'a',
  href: '/blogs/a',
  title: 'A post',
  excerpt: '',
  coverUrl: null,
  coverAlt: 'A post',
  category: null,
  tags: [],
  date: new Date('2026-01-01'),
  minutes: 1,
  author: null,
  ...o,
});

describe('blog model', () => {
  it('numbers duplicate headings so the table of contents and the article agree', () => {
    const h = headingsOf('## Intro\n\ntext\n\n## Intro\n\n### Deep dive!');
    expect(h.map((x) => x.id)).toEqual(['intro', 'intro-2', 'deep-dive']);
    expect(h[2]?.level).toBe(3);
  });

  it('reads about 200 words a minute, at least one', () => {
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(1000)).toBe(5);
  });

  it('filters by category and by a search over title, summary, tags and author', () => {
    const cards = [
      card({ slug: 'a', title: 'Check-in tips', category: 'Guides', tags: ['door'] }),
      card({ slug: 'b', title: 'Sponsors', category: 'Partners', author: 'Asha' }),
    ];
    expect(filterCards(cards, '', 'guides').map((c) => c.slug)).toEqual(['a']);
    expect(filterCards(cards, 'asha', '').map((c) => c.slug)).toEqual(['b']);
    expect(filterCards(cards, 'door', 'Partners')).toEqual([]);
    expect(categoriesOf(cards)).toEqual(['Guides', 'Partners']);
  });
});

describe('the Markdown subset for posts', () => {
  it('parses quotes, images and fenced code, and keeps unsafe image addresses out', () => {
    const b = parseMarkdown(
      '> a wise line\n\n![alt text](/api/blog-cover/x/y)\n\n![bad](javascript:alert(1))\n\n```\nconst a = 1;\n```',
    );
    expect(b.map((x) => x.t)).toEqual(['quote', 'img', 'p', 'pre']);
    expect(b[1]).toMatchObject({ src: '/api/blog-cover/x/y', alt: 'alt text' });
    expect(b[2]).toMatchObject({ t: 'p' });
    expect(b[3]).toMatchObject({ v: 'const a = 1;' });
  });

  it('refuses protocol-relative and data image sources', () => {
    expect(parseMarkdown('![x](//evil.example/a.png)')).toEqual([]);
    expect(parseMarkdown('![x](data:image/png;base64,AAAA)')).toEqual([]);
  });
});
