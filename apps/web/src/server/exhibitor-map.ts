import 'server-only';
import type { EventTarget } from '@yayatoh/events';
import { type PublicExhibitorMapDto, publicExhibitorMap } from '@yayatoh/program';
import { publicCached } from './public-cache.ts';

/**
 * The public exhibitor map (M5.4a), cached per org (key and tag lead with the org; booth and
 * listing changes revalidate the tag). The value is the allowlisted DTO, JSON-safe as is.
 */
export function cachedExhibitorMap(target: EventTarget): Promise<PublicExhibitorMapDto | null> {
  return publicCached(
    { org: target.orgId },
    ['exhibitor-map', target.eventId],
    () => publicExhibitorMap(target),
    (raw) => raw as PublicExhibitorMapDto | null,
  );
}
