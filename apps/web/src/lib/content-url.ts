import { type HostKind, originFor, type RequestOrigin } from './hosts.ts';

/**
 * Public URLs of an org's pages and posts (M1.4g, U3). Pure: `server/cms.ts` wraps it with the
 * request and the environment, and the unit tests cover one case per host class.
 */

/** Public path of an entry (the legacy Voyager paths: `/blogs/{slug}`, `/pages/{slug}`). */
export const entryPath = (kind: 'page' | 'post', slug: string) =>
  kind === 'page' ? `/pages/${slug}` : `/blogs/${slug}`;

/**
 * The organizer page's prefix on a host of this class: `/o/{slug}` on the marketplace, and the
 * long form `/organizers/{slug}` elsewhere (dev hosts and previews, where `/o/…` is the console).
 */
export function organizerBase(kind: HostKind, slug: string): string {
  return kind === 'marketplace' ? `/o/${slug}` : `/organizers/${slug}`;
}

export interface ContentRequest extends RequestOrigin {
  readonly kind: HostKind;
  readonly origin: string;
}

export interface ContentOrg {
  readonly slug: string;
  readonly tenantSite: boolean;
  readonly primaryHost: string | null;
}

/**
 * Where an org's pages and posts are canonical (roadmap §4.2, as for events): the marketplace
 * apex for the marketplace content org; the org's tenant site (managed subdomain or custom
 * domain) when it runs one; else its organizer page. The organizer page lives on the apex as
 * seen from this request: this host itself on the marketplace and on dev hosts (which serve the
 * marketplace too), the configured apex from the app host or a tenant host. Its prefix follows
 * the host class it ends up on, so a dev or preview host never links into the console.
 */
export function contentHomeFor(
  req: ContentRequest,
  o: ContentOrg,
  opts: { readonly apexHost: string; readonly isContentOrg: boolean },
): { origin: string; base: string } {
  const onThisHost = req.kind === 'marketplace' || req.kind === 'dev';
  const apex = onThisHost ? req.origin : originFor(req, opts.apexHost);
  if (opts.isContentOrg) return { origin: apex, base: '' };
  if (o.tenantSite && o.primaryHost)
    return { origin: o.primaryHost === req.host ? req.origin : originFor(req, o.primaryHost), base: '' };
  return { origin: apex, base: organizerBase(onThisHost ? req.kind : 'marketplace', o.slug) };
}

/** The canonical absolute URL of a published entry. */
export function contentUrlFor(
  req: ContentRequest,
  o: ContentOrg,
  kind: 'page' | 'post',
  slug: string,
  opts: { readonly apexHost: string; readonly isContentOrg: boolean },
): string {
  const home = contentHomeFor(req, o, opts);
  return `${home.origin}${home.base}${entryPath(kind, slug)}`;
}
