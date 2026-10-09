import 'server-only';
import { EVENT_CATEGORIES, listPlatformCategoryCatalog } from '@yayatoh/events';
import { cache } from 'react';

/** Request-scoped cache: admin changes appear on the next request without a server restart. */
export const platformCategoryCatalog = cache(listPlatformCategoryCatalog);

export async function categoryLabels(translate: (key: string) => string) {
  const catalog = await platformCategoryCatalog();
  const labels = new Map(catalog.map((c) => [c.key, c.label]));
  return (key: string) =>
    labels.get(key) ??
    ((EVENT_CATEGORIES as readonly string[]).includes(key) ? translate(key) : key.replaceAll('_', ' '));
}
