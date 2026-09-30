import { describe, expect, it } from 'vitest';
import {
  AggregateRatingSchema,
  aggregateRatingJsonLd,
  BlogPostingJsonLdSchema,
  blogPostingJsonLd,
  jsonLdScript,
} from '../src/lib/seo/jsonld.ts';

const post = {
  title: 'Summer line-up',
  description: 'What is on.',
  url: 'https://lakeside-events.yayatoh.events/blogs/summer-line-up',
  image: 'https://yayatoh.com/api/og/org/lakeside-events',
  publishedAt: new Date('2027-06-01T15:00:00Z'),
  updatedAt: new Date('2027-06-02T09:30:00Z'),
  authorName: 'Pani Lake',
  publisher: { name: 'Lakeside Events', url: 'https://lakeside-events.yayatoh.events/' },
};

describe('BlogPosting JSON-LD (M1.4g)', () => {
  it('is valid with absolute URLs, ISO dates, a Person author and the org as publisher', () => {
    const ld = BlogPostingJsonLdSchema.parse(blogPostingJsonLd(post));
    expect(ld).toMatchObject({
      headline: 'Summer line-up',
      url: post.url,
      mainEntityOfPage: post.url,
      datePublished: '2027-06-01T15:00:00.000Z',
      dateModified: '2027-06-02T09:30:00.000Z',
      author: { '@type': 'Person', name: 'Pani Lake' },
      publisher: { '@type': 'Organization', name: 'Lakeside Events' },
    });
  });

  it('falls back to the organization as author, omits an empty description, caps the headline', () => {
    const ld = BlogPostingJsonLdSchema.parse(
      blogPostingJsonLd({ ...post, authorName: null, description: null, title: 'x'.repeat(200) }),
    );
    expect(ld.author).toEqual({ '@type': 'Organization', name: 'Lakeside Events', url: post.publisher.url });
    expect(ld.description).toBeUndefined();
    expect(ld.headline).toHaveLength(110);
  });

  it('a title cannot close the script tag', () => {
    const s = jsonLdScript(blogPostingJsonLd({ ...post, title: '</script><script>alert(1)</script>' }));
    expect(s).not.toContain('</script>');
  });
});

describe('aggregateRating JSON-LD', () => {
  it('only from the minimum number of reviews, with one decimal', () => {
    expect(aggregateRatingJsonLd({ count: 2, average: 4.5 }, 3)).toBeNull();
    expect(aggregateRatingJsonLd({ count: 0, average: null }, 3)).toBeNull();
    const r = AggregateRatingSchema.parse(aggregateRatingJsonLd({ count: 3, average: 4 }, 3));
    expect(r).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.0',
      reviewCount: 3,
      bestRating: '5',
      worstRating: '1',
    });
  });
});
