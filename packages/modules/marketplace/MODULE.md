# marketplace (tier 6)

The public listings projection, the marketplace and tenant-site reads, per-org public site
settings and the legacy URL map. Owns Postgres schema `marketplace`.

**Invariants**
- `public_listings` is a projection (roadmap §3.3, §3.5 rule 4): written only by the
  `marketplace.listings` projector (outbox events from events, ticketing, tenancy) and by this
  module's own settings command, never by a runtime join. Each refresh rebuilds a row from its
  sources, so replays converge.
- A row exists only for a `public`, published or postponed event of an active or limited org.
  `on_marketplace` additionally needs the org's enrollment (owner D13: opt-in for new orgs) and
  is never true for weddings.
- Allowlisted columns only: no PII, no ids leave through the DTO. Cross-tenant reads (search,
  cities, sitemap, one listing by slug, redirects) go only through SECURITY DEFINER functions
  that return allowlisted columns; tenant sites read their own rows under RLS.
- Canonical host (roadmap §4.2): verified custom domain, else the tenant-apex subdomain when the
  org runs a tenant site, else null (the marketplace apex).
- Adding a website to the widget's embed origins grants it access to checkout: it needs a recent
  step-up (M1.2c). Removing origins and the other site settings do not.
- `legacy_redirects` rows are written only with the platform permission
  `platform:redirects.manage` (migration tooling); `(host, source)` is globally unique on purpose.
