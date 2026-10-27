import 'server-only';
import { getTranslations } from 'next-intl/server';
import { categoryLabels, platformCategoryCatalog } from '@/server/event-categories.ts';
import { TYPE_KEYS } from './categories.ts';
import type { RailItem } from './category-rail.tsx';
import { PILL_CATEGORIES } from './home-data.ts';

/** The profile keys the events list can filter by (weddings are private, so they link to their page). */
export const LISTABLE_TYPES = TYPE_KEYS.filter((t) => t !== 'wedding');

/**
 * The pills of the marketplace: our event types first (music and concerts, conferences, weddings,
 * galas, community, tours, corporate), then our event categories, with the platform's own labels.
 */
export async function railItems(): Promise<RailItem[]> {
  const tt = await getTranslations('showcase.types');
  const tc = await getTranslations('categories');
  const label = await categoryLabels((k) => tc(k as 'music'));
  const catalog = (await platformCategoryCatalog()).map((c) => c.key).filter((k) => k !== 'other');
  const topics = catalog.length > 0 ? catalog : [...PILL_CATEGORIES];
  return [
    ...TYPE_KEYS.map((k) => ({
      key: `type:${k}`,
      href: k === 'wedding' ? '/solutions/weddings' : `/events?type=${k}`,
      label: tt(k),
    })),
    ...topics.map((k) => ({ key: `topic:${k}`, href: `/events?topic=${k}`, label: label(k) })),
  ];
}

/** The label of a section key (`type:concert`, `topic:music`). */
export async function sectionLabel(key: string): Promise<string> {
  const [kind, id = ''] = key.split(':');
  if (kind === 'type') return (await getTranslations('showcase.types'))(id as 'concert');
  const tc = await getTranslations('categories');
  return (await categoryLabels((k) => tc(k as 'music')))(id);
}
