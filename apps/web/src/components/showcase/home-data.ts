import { EVENT_CATEGORIES } from '@yayatoh/events';
import type { PublicEventHit } from '@yayatoh/marketplace';
import { publicCovers } from '@yayatoh/media';
import { cachedShowcaseEvents } from '@/server/public-data.ts';
import { requestHost } from '@/server/request-origin.ts';
import type { OrganizerTile } from './organizers-panel.tsx';

/** The category pills: every platform category except the catch-all, in the taxonomy's order. */
export const PILL_CATEGORIES = EVENT_CATEGORIES.filter((c) => c !== 'other');

export interface CategorySection {
  readonly key: string;
  readonly events: readonly PublicEventHit[];
}

/**
 * Everything the marketplace home shows, from one cached read of the next upcoming public events:
 * the featured row (events with a picture first, then the soonest), the busiest categories as
 * rows of their own, and the organizers behind the events.
 */
export async function loadShowcaseHome(sectionCount = 3) {
  const events = await cachedShowcaseEvents(100);
  const covers = await publicCovers(events.map((e) => e.slug));
  const withCover = events.filter((e) => covers.has(e.slug));
  const featured = [...withCover, ...events.filter((e) => !covers.has(e.slug))].slice(0, 10);
  const byCategory = new Map<string, PublicEventHit[]>();
  for (const e of events) {
    if (!e.category || e.category === 'other') continue;
    byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e]);
  }
  const sections: CategorySection[] = [...byCategory.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, sectionCount)
    .map(([key, list]) => ({ key, events: list.slice(0, 10) }));
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
