import { LISTED_STATUSES } from '../schema.ts';

export interface ListingSource {
  readonly event: {
    readonly status: string;
    readonly visibility: string;
    readonly profile: string;
  };
  readonly org: {
    readonly status: string;
    readonly primaryHost: string | null;
    readonly primaryHostManaged: boolean;
    /** M6.3a: a sandbox org is never on the marketplace. */
    readonly sandbox?: boolean;
  };
  readonly settings: { readonly listOnMarketplace: boolean; readonly tenantSite: boolean };
}

/**
 * Whether an event has a public listing at all (tenant site, sitemap, marketplace candidates):
 * published or postponed, `public` visibility, org active or limited. Unlisted and private events,
 * drafts, cancelled, completed and archived events never do.
 */
export function isListable(s: ListingSource): boolean {
  return (
    (LISTED_STATUSES as readonly string[]).includes(s.event.status) &&
    s.event.visibility === 'public' &&
    (s.org.status === 'active' || s.org.status === 'limited')
  );
}

/**
 * Shown on the marketplace: listable, org enrolled (D13: opt-in), never a wedding (D13), never a
 * sandbox org's event (M6.3a).
 */
export function isOnMarketplace(s: ListingSource): boolean {
  return (
    isListable(s) && s.settings.listOnMarketplace && s.event.profile !== 'wedding' && s.org.sandbox !== true
  );
}

/**
 * The canonical "home" host of an org's event (roadmap §4.2): a verified custom domain, else the
 * tenant apex subdomain if the org runs a tenant site, else null (= the marketplace apex,
 * `yayatoh.com/events/{slug}`, which keeps migrated events' SEO intact).
 */
export function canonicalHostFor(
  org: ListingSource['org'],
  settings: ListingSource['settings'],
): string | null {
  if (!org.primaryHost) return null;
  if (!org.primaryHostManaged) return org.primaryHost;
  return settings.tenantSite ? org.primaryHost : null;
}
