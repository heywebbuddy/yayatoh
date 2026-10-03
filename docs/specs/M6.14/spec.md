# Spec: M6.14 — Marketplace v2

- **Milestone:** M6.14 (roadmap Phase 6; plan `docs/plans/phase-6.md` rows M6.14a/b)
- **Status:** Approved (owner, 2026-10-02: Phase 6 plan, decisions P6-1…P6-13; P6-11 Meilisearch)
- **Risk tags:** db-migration, tenancy
- **Related:** D13 (weddings and private events never public; marketplace opt-in), M1.11 (the
  `public_listings` projection, public cache helpers), ADR 0008 (outbox, projections)

Delivered in increments: **M6.14a** search, recommendations and listing moderation (this section),
**M6.14b** venue portal, shared layouts and promoted placements.

## M6.14a — Marketplace search (built)

### 1. Goal and users
Visitors to yayatoh.com find events by text, category, price, date and place — near them or near a
city — and discover similar, nearby and popular events. Staff keep the marketplace clean by hiding
a listing (and showing it again) with a reason. Nothing private can reach search: the index is fed
only from the public read model, and every answer is re-read from it.

### 2. What was built
- **`SearchIndex` port** (`@yayatoh/marketplace`, `src/search/`): the Meilisearch adapter (HTTP API:
  index + settings, add-or-replace and delete-batch documents, tasks awaited, `/multi-search`,
  `_geoRadius` filters, `_geoPoint` sorting, facets, exact `page`/`hitsPerPage` totals) and
  `fakeMeilisearch()` (in-memory, same HTTP surface, strict on keys, attributes and the document
  allowlist). `searchIndexFromEnv`: Meilisearch when `MEILISEARCH_URL` and both keys are set; the
  fake in dev, CI and previews (one per process, loaded from the read model on first use); off in
  production otherwise (`/search` redirects to `/events`). `.env.example` names only.
- **Feed via the outbox.** The listings projector now also writes `category`, the venue's rounded
  location (`latitude`, `longitude`; none for online events) and `popularity` (the org's visible
  review count; it follows `review.*` and `venue.updated` events), keeps hidden listings off the
  marketplace, and emits `marketplace.listing_changed@1` after each row change. The
  `marketplace.search-index` subscriber (worker, real Meilisearch only) syncs one document from the
  row; `reindexAll` / `pnpm --filter @yayatoh/worker search:reindex` rebuilds from
  `marketplace.index_listings`. Dev/CI: `POST /api/dev/search/run` (dev auth only) runs the indexer
  for an org in the web process and revalidates its cache tags.
- **Search** (`searchMarketplace`): text over name, tagline, organizer, venue and city; facets
  category, city and price band (each counted without its own filter) and date presets
  (today / 7 days / 30 days, UTC days) with counts; from/to dates; geo within 5–100 km of a city's
  centre (`marketplace.listing_city_centers`) or of the visitor (`near=me` with the browser's
  location, rounded to ~1 km in the URL); sorts soonest, nearest, most popular. Hits are hydrated
  through `marketplace.listings_by_slugs` (marketplace rows of live orgs, never weddings, not ended).
- **Recommendations**: `similarListings` (same category, else same city; nearest or soonest),
  `nearbyListings` (within 50 km, nearest first), `popularListings` (popularity, then soonest).
- **Web**: `/search` (marketplace host only; GET form with U1 `Select`s whose options carry counts;
  "Use my location" client button; result, similar, nearby and popular grids with distances); a
  link from `/events` and "Find similar events" on the marketplace event page. Cached through
  `publicCached('marketplace', …)` (cross-tenant data: the marketplace tag every org change
  revalidates). Permissions-Policy allows `geolocation=(self)` on `/search` only.
- **Staff moderation** (`apps/admin` `/listings`, staff action `listings`: admins and support):
  Listed / Hidden tabs, search by event or organizer, hide or show with a required reason
  (`marketplace.moderateListing`, platform permission, audited in the org with the reason), the
  queue read through platform_reader (access log first). The table `marketplace.listing_moderation`
  (FORCE RLS, org-led indexes) holds the current state per event.

### 3. Later / not yet
- Typo tolerance and relevance ranking are Meilisearch's; the fake matches word prefixes only.
- A zero-downtime reindex (index swap) and a periodic consistency sweep (index vs read model).
- Notify the organizer when staff hide a listing; organizer-side appeal.
- Cross-currency price bands; a map view (the list with distances is the accessible default).
- Search on tenant sites (org-scoped search) and in `/v1`.

### 4. Acceptance

| Criterion | Tests |
|---|---|
| Search returns only public listings; leak crawler covers every indexed field | `packages/testing/tests/marketplace-search.int.test.ts` (leak crawler: canary org, every document, search/similar/popular answers and a full reindex; `INDEXED_FIELDS` ↔ public/vocab columns), `packages/modules/marketplace/tests/search.test.ts` (allowlist `.strict()`, fake refuses off-allowlist documents and non-configured attributes), `apps/web/e2e/marketplace-search.spec.ts` |
| Weddings and private events never appear, even if mis-flagged later (removal on the next event) | `marketplace-search.int.test.ts` "weddings and private events never appear (D13)" (wedding/private/unlisted never indexed; public → wedding or private later leaves the index; a corrupted row is refused by the indexer, hydration and reindex), e2e "search with facets…" (wedding and private by name) and "a hidden listing leaves search on the next event" |
| Index fed from `public_listings` via the outbox; geo search and facets | int "the index follows the public read model through the outbox" (projector → event → indexer, idempotent replay, facets, geo, reindex equality, opt-out leaves), e2e facets + geo + location tests |
| Recommendations (similar, nearby, popular) from public data only | int "recommends similar, nearby and popular events", e2e "open a recommendation" |
| Listing moderation queue for staff (hide/unhide with reason, audited) | int "listing moderation (staff)" (rebuild-proof, audit with reason, validation, permissions), `apps/worker/tests/listing-moderation.int.test.ts` (cross-org queue via platform_reader, access log, staff actor in the audit), `apps/admin/e2e/listings.spec.ts` (hide/show with reason, required reason, search follows, keyboard only, axe both themes, finance refused incl. crafted submission), `apps/admin/tests/staff-roles.test.ts` |
| Cache keys and tags include the org where org-scoped | search v2 reads are cross-tenant and cached under the `marketplace` scope only (`apps/web/src/server/public-data.ts`), which `orgChangeTags` revalidates on any org change; the dev drain and the worker's indexer revalidate the org's tags; check-modules `cache-scope` gate |
| E2E: search with facets and geo, open a recommendation, staff hides a listing; keyboard only, axe both themes, RTL | `apps/web/e2e/marketplace-search.spec.ts` (3 projects), `apps/admin/e2e/listings.spec.ts` |
| Index selection (fake in dev/CI, off in production by default), worker registers the indexer only for Meilisearch | `search.test.ts` "index selection", `apps/worker/tests/search.test.ts` |
