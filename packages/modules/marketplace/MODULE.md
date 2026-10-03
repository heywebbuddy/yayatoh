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

**Search v2 (M6.14a, P6-11)**
- **The port.** `SearchIndex` (`src/search/port.ts`): `setup`, `upsert`, `remove`, `clear`, `search`
  (multi-search). Adapter `meilisearchIndex` (HTTP API; admin key writes, search-only key reads);
  `fakeMeilisearch()` is the only Meilisearch dev and CI talk to (strict: admin vs search keys,
  filter/sort/facet attributes must be configured, every stored document must pass the allowlist).
  `searchIndexFromEnv`: Meilisearch with `MEILISEARCH_URL` + both keys; the per-process fake in dev,
  CI and previews; null (off) in production otherwise.
- **Fed only from the public read model.** The projector emits `marketplace.listing_changed@1`
  (payload: the event id) after it rewrote or dropped a row; the `marketplace.search-index`
  subscriber reads that row under RLS and indexes it only when `on_marketplace` and not a wedding
  (D13's second lock), else removes it. `reindexAll` reads `marketplace.index_listings` (SECURITY
  DEFINER: marketplace rows of live orgs, never weddings).
- **Documents** (`SearchDocument`, `.strict()`): public listing fields only, an opaque id (hash of
  org and event), unix-second dates, the price band, the venue's location rounded to ~100 m, the
  popularity (the org's visible review count). `INDEXED_FIELDS` maps each field to its source
  columns; the canary test checks they are public or vocab.
- **Answers come from the read model.** Searches and recommendations only order slugs; the rows
  shown come from `marketplace.listings_by_slugs` (same rules), so a stale index entry never shows.
- **Moderation.** `listing_moderation` (one row per event; history in the audit log): staff
  (`platform:marketplace.moderate_listing`) hide or show a listing with a reason; the projector keeps
  a hidden listing off the marketplace through every rebuild (the tenant site keeps it).
- **Promoted placements (M6.14b, flag `PROMOTED_PLACEMENTS`):** `promotions` (one per event, 1–30 days, only marketplace listings, never weddings). Search reads running ones through the SECURITY DEFINER `promoted_slugs(now)` and shows at most `PROMOTED_SLOTS` that match the visitor's query and filters, page 1 only, hydrated from the public read model and always labelled as promoted. Nothing is charged.
