import { EVENT_CATEGORIES } from '@yayatoh/events';
import type { PublicEventHit } from '@yayatoh/marketplace';
import { publicCovers } from '@yayatoh/media';
import { cachedShowcaseEvents } from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import type { OrganizerTile } from './organizers-panel.tsx';

/** The category pills: every platform category except the catch-all, in the taxonomy's order. */
export const PILL_CATEGORIES = EVENT_CATEGORIES.filter((c) => c !== 'other');

/** Our event types as sections and pills, in the order the home shows them (weddings are never listed). */
export const SECTION_TYPES = ['concert', 'conference', 'gala', 'community', 'tour', 'agency'] as const;

export interface CategorySection {
  /** `type:concert` or `topic:music`. */
  readonly key: string;
  readonly events: readonly PublicEventHit[];
}

/**
 * Everything the marketplace home shows, from one cached read of the next upcoming public events:
 * the featured row (events with a picture first, then the soonest), the busiest categories as
 * rows of their own, and the organizers behind the events.
 */
export async function loadShowcaseHome(topicSections = 2) {
  const events = await cachedShowcaseEvents(100);
  const covers = await publicCovers(events.map((e) => e.slug));
  const withCover = events.filter((e) => covers.has(e.slug));
  const featured = [...withCover, ...events.filter((e) => !covers.has(e.slug))].slice(0, 10);
  const byCategory = new Map<string, PublicEventHit[]>();
  for (const e of events) {
    if (!e.category || e.category === 'other') continue;
    byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e]);
  }
  const typeSections: CategorySection[] = SECTION_TYPES.flatMap((type) => {
    const list = events.filter((e) => e.profile === type);
    return list.length > 0 ? [{ key: `type:${type}`, events: list.slice(0, 10) }] : [];
  });
  const sections: CategorySection[] = [
    ...typeSections,
    ...[...byCategory.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, topicSections)
      .map(([key, list]) => ({ key: `topic:${key}`, events: list.slice(0, 10) })),
  ];
  const req = await requestHost();
  const organizerHref = (slug: string) => (req.kind === 'marketplace' ? `/o/${slug}` : `/organizers/${slug}`);
  const counts = new Map<string, OrganizerTile>();
  for (const e of events) {
    const seen = counts.get(e.orgSlug);
    counts.set(e.orgSlug, {
      slug: e.orgSlug,
      name: e.orgName,
      events: (seen?.events ?? 0) + 1,
      href: organizerHref(e.orgSlug),
    });
  }
  const organizers = [...counts.values()]
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name))
    .slice(0, 9);
  return {
    events,
    covers,
    featured,
    sections,
    organizers,
    heroCover: featured[0] ? (covers.get(featured[0].slug) ?? null) : null,
  };
}
