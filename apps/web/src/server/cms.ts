import 'server-only';
import {
  type NavPageDto,
  navPages,
  type PublicEntryDto,
  type PublicEntryPageDto,
  publicEntries,
  publicEntry,
} from '@yayatoh/cms';
import {
  type PublicOrganizer,
  publicOrganizer,
  publicOrganizerById,
  publicSiteSettings,
} from '@yayatoh/marketplace';
import { contentHomeFor, contentUrlFor, entryPath, organizerBase as organizerBaseFor } from '@/lib/content-url.ts';
import { apexHost } from '@/lib/hosts.ts';
import { publicCached } from './public-cache.ts';
import type { RequestHost } from './request-origin.ts';

type Raw = Record<string, unknown>;
const date = (v: unknown) => new Date(String(v));
const reviveEntry = (e: Raw) =>
  ({ ...e, publishedAt: date(e.publishedAt), updatedAt: date(e.updatedAt) }) as unknown as PublicEntryDto;

export { entryPath };

/**
 * The org whose pages and posts the marketplace itself shows at `yayatoh.com/blogs/…` and
 * `/pages/…` (the platform org that receives yayatoh.com's Voyager content at ELT, roadmap T7).
 * Configured by `MARKETPLACE_CONTENT_ORG` (an org slug); unset → those URLs are 404.
 */
export async function marketplaceContentOrg(): Promise<PublicOrganizer | null> {
  const slug = process.env.MARKETPLACE_CONTENT_ORG?.trim();
  return slug ? publicOrganizer(slug) : null;
}

const isContentOrg = (o: PublicOrganizer) => process.env.MARKETPLACE_CONTENT_ORG?.trim() === o.slug;

/** Is this org (by slug) the marketplace content org, whose console edits the help center and marketing site? */
export const isPlatformContentOrg = (slug: string) => process.env.MARKETPLACE_CONTENT_ORG?.trim() === slug;

/** Where an org's pages and posts are canonical on this request (see `contentHomeFor`). */
export function contentHome(req: RequestHost, o: PublicOrganizer): { origin: string; base: string } {
  return contentHomeFor(req, o, { apexHost: apexHost(), isContentOrg: isContentOrg(o) });
}

/** The canonical absolute URL of a published entry. */
export function contentPublicUrl(req: RequestHost, o: PublicOrganizer, kind: 'page' | 'post', slug: string) {
  return contentUrlFor(req, o, kind, slug, { apexHost: apexHost(), isContentOrg: isContentOrg(o) });
}

/**
 * Link prefix for content pages on *this* request: a tenant host and the marketplace content
 * pages use root paths; an organizer page uses `/o/{slug}` on the marketplace host and
 * `/organizers/{slug}` on dev hosts (where `/o/…` is the console).
 */
export function organizerBase(req: RequestHost, slug: string): string {
  return organizerBaseFor(req.kind, slug);
}

export const cachedEntries = (orgId: string, kind: 'page' | 'post', page: number) =>
  publicCached(
    { org: orgId },
    ['cms-list', kind, page],
    () => publicEntries(orgId, kind, page),
    (raw) => {
      const p = raw as PublicEntryPageDto & { items: Raw[] };
      return { ...p, items: p.items.map(reviveEntry) } as PublicEntryPageDto;
    },
  );

export const cachedEntry = (orgId: string, kind: 'page' | 'post', slug: string) =>
  publicCached(
    { org: orgId },
    ['cms-entry', kind, slug],
    () => publicEntry(orgId, kind, slug),
    (raw) => (raw ? reviveEntry(raw as Raw) : null),
  );

/** The published pages the org links from its tenant site's navigation (site settings). */
export const cachedNavPages = (orgId: string) =>
  publicCached(
    { org: orgId },
    ['cms-nav'],
    async () => navPages(orgId, (await publicSiteSettings(orgId)).navPageIds),
    (raw) => raw as NavPageDto[],
  );

/** A tenant site's content (the org is the proxy's route param, resolved from the host). */
export async function tenantContentSite(orgId: string | null) {
  const org = orgId ? await publicOrganizerById(orgId) : null;
  return org ? { org, variant: 'tenant' as const, base: '' } : null;
}

/** An organizer page's content on the marketplace (`/o/{slug}/blogs/…`). */
export async function organizerContentSite(req: RequestHost, slug: string) {
  const org = await publicOrganizer(slug);
  return org ? { org, variant: 'organizer' as const, base: organizerBase(req, org.slug) } : null;
}

/** The marketplace's own pages and posts (`yayatoh.com/blogs/…`, `/pages/…`). */
export async function marketplaceContentSite() {
  const org = await marketplaceContentOrg();
  return org ? { org, variant: 'marketplace' as const, base: '' } : null;
}
