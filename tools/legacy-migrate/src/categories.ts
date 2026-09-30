import { EVENT_CATEGORIES, type EventCategory } from '@yayatoh/events';

/**
 * Legacy categories → the platform taxonomy (roadmap §7.5 T3: "yayatoh.com becomes the platform
 * taxonomy; abc categories become org tags or mapped categories"). A legacy category is matched by
 * keywords in its name or slug; the first rule that matches wins. Nothing matched → `other`, and
 * the category is listed for owner review.
 */
const RULES: readonly [RegExp, EventCategory][] = [
  [/music|concert|jazz|band|dj\b|festival/, 'music'],
  [/business|seminar|conference|summit|network|career|professional/, 'business_seminars'],
  [/charit|fundrais|donat|non-?profit|gala/, 'charity'],
  [/educat|class|course|workshop|training|lecture|school/, 'education_classes'],
  [/famil|kid|child/, 'family'],
  [/food|drink|dinner|wine|beer|culinar|brunch|tasting/, 'food_drink'],
  [/health|wellness|yoga|medit/, 'health_wellness'],
  [/night|party|club/, 'nightlife'],
  [/relig|church|spiritual|faith|worship|mosque|temple/, 'religion_spirituality'],
  [/social|meetup|mixer|gathering/, 'social_gatherings'],
  [/sport|fitness|run\b|marathon|game|tournament/, 'sports_fitness'],
  [/tech|hackathon|coding|developer|startup|\bai\b/, 'technology'],
  [/travel|tour|trip|leisure|outdoor/, 'travel_leisure'],
  [/art|cultur|theat|film|comedy|dance|exhibit|gallery|poetry/, 'arts_culture'],
  [/communit|civic|local|neighbo/, 'community'],
];

export function mapCategory(
  name: string,
  slug?: string | null,
): { category: EventCategory; matched: boolean } {
  const text = `${name} ${slug ?? ''}`.toLowerCase();
  for (const [re, category] of RULES) if (re.test(text)) return { category, matched: true };
  return { category: 'other', matched: false };
}

export const PLATFORM_CATEGORIES: readonly string[] = EVENT_CATEGORIES;

/**
 * Series inference key (roadmap §7.5 T3): an event title with its year(s), ordinals ("5th"),
 * "annual" and punctuation removed, lowercased. Two events of one org with the same key in
 * different years are one series.
 */
export function seriesKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)\b/g, ' ')
    .replace(/\bannual\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The series name: the most recent event's title without its year, tidied. */
export function seriesName(title: string): string {
  const n = title
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s*[-–—:|,]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (n.length >= 2 ? n : title.trim()).slice(0, 160);
}
