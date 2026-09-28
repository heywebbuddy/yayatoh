import { describe, expect, it } from 'vitest';
import {
  ctaHrefProblem,
  foldText,
  pickLocale,
  plainExcerpt,
  rankArticles,
  relatedArticles,
  searchTerms,
} from '../src/domain/help.ts';

const doc = (slug: string, title: string, over: Partial<{ summary: string; keywords: string; body: string }> = {}) => ({
  slug,
  title,
  summary: over.summary ?? null,
  keywords: over.keywords ?? null,
  body: over.body ?? '',
});

describe('search terms (M3.11b)', () => {
  it('folds case, accents and width; drops one-letter words except in CJK', () => {
    expect(searchTerms('  Réembolser  un Billet! a ')).toEqual(['reembolser', 'un', 'billet']);
    expect(foldText('ＴＩＣＫＥＴ')).toBe('ticket');
    expect(searchTerms('票')).toEqual(['票']);
    expect(searchTerms('x')).toEqual([]);
  });

  it('dedupes and keeps at most 8 terms; long queries are cut', () => {
    expect(searchTerms('seat seat SEAT')).toEqual(['seat']);
    expect(searchTerms('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10')).toHaveLength(8);
    expect(searchTerms(`${'z'.repeat(200)} refund`)).toEqual(['z'.repeat(120)]);
  });

  it('keeps Arabic words intact (marks folded on both sides)', () => {
    expect(searchTerms('استرداد المبلغ')).toEqual(['استرداد', 'المبلغ']);
    expect(searchTerms('اِسْتِرْدَاد')).toEqual(['استرداد']);
  });
});

describe('ranking (M3.11b)', () => {
  const docs = [
    doc('body-only', 'Payouts', { body: 'You can refund an order from the order page.' }),
    doc('summary', 'Orders', { summary: 'How to refund an order' }),
    doc('keywords', 'Money back', { keywords: 'refund, cancel order' }),
    doc('title', 'Refund an order'),
    doc('unrelated', 'Seating charts', { body: 'Rows and tables.' }),
  ];

  it('ranks title over keywords over summary over body, and drops non-matches', () => {
    const r = rankArticles('refund', docs).map((x) => x.doc.slug);
    expect(r).toEqual(['title', 'keywords', 'summary', 'body-only']);
  });

  it('prefers articles holding more of the terms, then the whole phrase in the title', () => {
    const r = rankArticles('refund order', [
      doc('one-term', 'Refund policies'),
      doc('both-in-body', 'Help', { body: 'order refund' }),
      doc('phrase', 'How to refund order items'),
      doc('both-apart', 'Order changes and refund rules'),
    ]);
    expect(r.map((x) => x.doc.slug)).toEqual(['phrase', 'both-apart', 'both-in-body', 'one-term']);
    expect(r[0]?.matched).toBe(2);
  });

  it('whole words beat word starts beat inner matches; ties fall back to the title', () => {
    const r = rankArticles('seat', [
      doc('inner', 'Loveseats for rent'),
      doc('prefix', 'Seating charts'),
      doc('word', 'Pick a seat'),
      doc('word-b', 'A seat for everyone'),
    ]);
    expect(r.map((x) => x.doc.slug)).toEqual(['word-b', 'word', 'prefix', 'inner']);
  });

  it('matches accents, other scripts and CJK without spaces', () => {
    expect(rankArticles('reembolso', [doc('es', 'Reembolsó rápido')]).map((x) => x.doc.slug)).toEqual(['es']);
    expect(rankArticles('استرداد', [doc('ar', 'طلب استرداد المبلغ'), doc('en', 'Refund')]).map((x) => x.doc.slug)).toEqual(['ar']);
    expect(rankArticles('チケット', [doc('ja', 'チケットを譲渡する')]).map((x) => x.doc.slug)).toEqual(['ja']);
    expect(rankArticles('退款', [doc('zh', '申请退款')]).map((x) => x.doc.slug)).toEqual(['zh']);
  });

  it('an empty or punctuation-only query ranks nothing', () => {
    expect(rankArticles('', docs)).toEqual([]);
    expect(rankArticles(' ?! ', docs)).toEqual([]);
  });
});

describe('related articles (M3.11b)', () => {
  const a = (slug: string, categorySlug: string, position: number, keywords: string | null = null) => ({
    slug,
    categorySlug,
    title: slug,
    keywords,
    position,
  });
  it('same category first by position, then others sharing keywords; never itself; capped', () => {
    const me = a('me', 'tickets', 1, 'refund, transfer');
    const all = [
      me,
      a('c', 'tickets', 3),
      a('b', 'tickets', 2),
      a('x', 'payouts', 1, 'refund'),
      a('y', 'payouts', 2, 'Refund, TRANSFER'),
      a('z', 'seating', 1, 'seats'),
    ];
    expect(relatedArticles(me, all).map((r) => r.slug)).toEqual(['b', 'c', 'y', 'x']);
    expect(relatedArticles(me, all, 2).map((r) => r.slug)).toEqual(['b', 'c']);
  });
});

describe('locale fallback (M3.11b)', () => {
  it('per slug: the reader’s locale, else English; other locales ignored; order kept', () => {
    const rows = [
      { slug: 'a', locale: 'en', n: 1 },
      { slug: 'a', locale: 'ar', n: 2 },
      { slug: 'b', locale: 'en', n: 3 },
      { slug: 'c', locale: 'de', n: 4 },
      { slug: 'd', locale: 'ar', n: 5 },
    ];
    expect(pickLocale(rows, 'ar').map((r) => r.n)).toEqual([2, 3, 5]);
    expect(pickLocale(rows, 'en').map((r) => r.n)).toEqual([1, 3]);
    expect(pickLocale(rows, 'fr').map((r) => r.n)).toEqual([1, 3]);
  });
});

describe('call-to-action links (M3.11b)', () => {
  it('allows site paths and https; refuses protocol-relative, other schemes and credentials', () => {
    for (const ok of ['/', '/features', '/help/check-in?x=1', 'https://yayatoh.com/pricing'])
      expect(ctaHrefProblem(ok)).toBeNull();
    for (const bad of [
      '//evil.test',
      '/\\evil.test',
      'http://yayatoh.com',
      'javascript:alert(1)',
      'mailto:x@y.z',
      'https://user:pw@evil.test',
      '/a b',
      'features',
      `/${'a'.repeat(300)}`,
    ])
      expect(ctaHrefProblem(bad)).toBe('format');
  });
});

describe('plain excerpt', () => {
  it('drops Markdown markup, keeps hyphenated words and caps the length', () => {
    expect(plainExcerpt('## Check-in\n\n- **Scan** the [code](https://x.test)\n1. Done')).toBe('Check-in Scan the code Done');
    expect(plainExcerpt('word '.repeat(100), 20)).toMatch(/…$/);
    expect(plainExcerpt('word '.repeat(100), 20).length).toBeLessThanOrEqual(20);
  });
});
