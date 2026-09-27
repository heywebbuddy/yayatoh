/**
 * The platform category taxonomy (M1.4c). yayatoh.com's legacy categories become platform
 * categories (roadmap §7); labels are translated in the web app under `categories.*`.
 */
export const EVENT_CATEGORIES = [
  'arts_culture',
  'business_seminars',
  'charity',
  'community',
  'education_classes',
  'family',
  'food_drink',
  'health_wellness',
  'music',
  'nightlife',
  'religion_spirituality',
  'social_gatherings',
  'sports_fitness',
  'technology',
  'travel_leisure',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const ATTENDANCE_MODES = ['in_person', 'online', 'hybrid'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

/** Org tags: trimmed, inner whitespace collapsed; compared case-insensitively. */
export const MAX_TAGS_PER_EVENT = 10;
export const MAX_TAG_LENGTH = 40;

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}

export function tagKey(tag: string): string {
  return normalizeTag(tag).toLocaleLowerCase('en');
}

/**
 * Parse a comma-separated tag list: de-duplicated case-insensitively (first spelling wins),
 * empty entries dropped. Throws on a tag that is too long or too many tags.
 */
export function parseTags(raw: string | readonly string[]): string[] {
  const parts = typeof raw === 'string' ? raw.split(',') : raw;
  const seen = new Map<string, string>();
  for (const p of parts) {
    const t = normalizeTag(p);
    if (!t) continue;
    if (t.length > MAX_TAG_LENGTH) throw new TagError('tag_too_long');
    if (!seen.has(tagKey(t))) seen.set(tagKey(t), t);
  }
  if (seen.size > MAX_TAGS_PER_EVENT) throw new TagError('too_many_tags');
  return [...seen.values()];
}

export class TagError extends Error {
  readonly reason: 'tag_too_long' | 'too_many_tags';
  constructor(reason: 'tag_too_long' | 'too_many_tags') {
    super(reason);
    this.reason = reason;
  }
}
