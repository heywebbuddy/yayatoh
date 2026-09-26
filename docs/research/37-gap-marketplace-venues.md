# Marketplace Discovery Seo And Venue Directory

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Marketplace discovery, SEO canonical ownership and venue directory for multi-tenant, white-label Yayatoh 2.0

# Marketplace, discovery SEO and venue directory: Yayatoh 2.0 gap-fill

Grounded in the vision document at `/Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx`, found by search because `${args.visionPath}` was not resolved. The relevant parts are §2 (multi-tenant isolation), §3 (custom domains such as events.organization.com), §4 (mobile API) and §12 (per-type simple workflows). Research date: 2026-09-26.

## 0. Critical finding on the live site (act now, separate from the rebuild)

A read-only inspection of production yayatoh.com (Eventmie Pro / Laravel + Vue 2) found the following.

- **Organizer secrets and PII are exposed.** The unauthenticated `GET /events/api/get_events` returns each event with a nested `user` object whose **field names** include `bank_account_number`, `bank_code`, `mailchimp_apikey`, `magic_login_token`, `fcm_token`, `apn_token`, `stripe_account_id`, `email`, `phone`, `ip_address` and `taxpayer_number`. It also returns `e_admin_commission`.
- **Values were not inspected.** Treat this as a live incident until the owner confirms otherwise. Steps: hide the attributes (`$hidden` / API Resources), rotate Mailchimp keys, invalidate magic-login tokens, and review the access logs.
- **Implication for the rebuild.** The marketplace must serve a **whitelisted projection**, never serialized domain models.

The same inspection also found:

- Event pages already emit JSON-LD `Event` (`eventStatus`, `eventAttendanceMode`, `offers`, `organizer`). There is **no `rel=canonical`**.
- Language is switched by session (`/lang/{xx}`), so no locale URLs exist and hreflang is impossible today.
- Legacy URLs that must survive:
  - `/events/{slug}`
  - `/e/{short_url}`
  - `/events/{slug}/tag_{tag}`
  - `/venues/{slug}` and the `venues/request_quote` POST
  - `/blogs/{slug}`
  - a **root catch-all `/{organisation_url}`** for organizer profiles
  - mobile routes `/api/v2/organiser/{organisation_url}` and `/api/v2/...`
- Venues today are organizer-created records (`organizer_id`, `venue_type`, `glat`/`glong`) shown in a public directory.
- Marketplace inventory is tiny: the public API reported 2 upcoming events, and the home page shows 4 venues.

## 1. How competitors handle listing, consent and discovery

| Platform | Listing consent model | Discovery / ranking | Own-domain pages |
|---|---|---|---|
| **Eventbrite** (Bending Spoons closed the ~$500M purchase on 2026-03-10) | Public vs Private. Public means the Eventbrite directory, search engines **and** partner sites (Spotify, Bandsintown and others; 50+ partners). Private means link-only or password. | Eligible only if live, not yet started, public, not TBA location, and ToS-compliant. Ranking uses title keywords, up to 10 tags and description; no manual boosts. Paid **Eventbrite Ads** use a daily budget (third-party reports $2–5+/day; UNVERIFIED at source). | No custom-domain event pages (UNVERIFIED). |
| **Luma** | Public events go on the host calendar and are *eligible* for Discover. Events can be submitted to other calendars and appear on several at once. | Automated plus human curation. Gates: public, in-person, recognised location, 1:1 cover, ≥5 pre-registered guests, **all ticketing on Luma**. | No white-label URLs, only `luma.com/slug` (Luma Plus); embed/API recommended instead. |
| **Humanitix** | Public means Humanitix search, host profile and search engines. Private means link-only, and categories are disabled. | Google-Maps address, keywords/categories, **host follower count**, and popularity (visits and sales). No listing fee: 5% + $1.29 per paid ticket in the US, free events free. | No custom domain found (UNVERIFIED). |
| **Ticket Tailor** | Listed on `/discover` by default. A per-event checkbox, "Hide this event from your box office listings and search engines", removes both together. | Not documented. | Box office custom domain via CNAME. What happens to the old URL is UNVERIFIED (help centre returned 403). |
| **DICE** (Fever acquired it June 2025) | Curated partners (promoters/venues); everything on DICE is in-app. | Personalised feed from Spotify/Apple Music sync plus follows of artists and venues. Reportedly about half of sales come via recommendations (secondary source). | n/a |

**Takeaways**
- Every platform lists for free and monetizes through ticket fees and ads/featured slots.
- Most **conflate** "public", "listed in the marketplace" and "indexable". That fails Yayatoh's white-label customers, who want Google indexing on their own domain but not a listing next to competitors on yayatoh.com.
- Luma's rule of "checkout must be on-platform to be featured" is the right quality gate.

## 2. Recommended marketplace listing model

Use **three independent flags**, not one.

1. `events.visibility`: `public | unlisted | private` (password/invite). This controls access only. Preserve the legacy `is_private` + password here.
2. `events.marketplace_listing`: `inherit | on | off`. It resolves against `organizations.marketplace_status` (`not_enrolled | enrolled | suspended`).
3. `events.search_indexing`: `on | off`. It defaults to on for public events and is forced off for unlisted and private events.

**Consent**
- Enrollment is an org-level act: accept the Marketplace Terms, recording `terms_version`, `accepted_by` and `accepted_at`.
- Defaults by org type:
  - Self-serve organizers on yayatoh.com URLs: **enrolled by default**, opt-out. This matches Eventbrite, Humanitix and Ticket Tailor and keeps inventory flowing.
  - White-label / custom-domain plans: **not enrolled**, opt-in.
  - Wedding and private-social templates: `unlisted` regardless of org settings. Google also excludes invitation-only events from Event rich results.
- Migration: grandfather current public events as enrolled, and send notice with a one-click opt-out.

**Eligibility gate** (computed, not a manual flag)
- Published and in the future.
- Geocoded place, or explicitly online.
- Category set, image of at least 1200px, description of at least 300 characters.
- **Checkout on Yayatoh**; no external ticket links.
- Org has completed Stripe Connect KYC, or ID verification for free-only orgs.
- Trust score passes.
- The first event from a new org goes to a moderation queue.

**Fees**
- **No listing fee at launch.** It is the industry norm, and with 2 upcoming events there is nothing to charge for yet.
- Record `orders.acquisition_channel` (`marketplace | tenant_site | app | direct | partner`) and `referrer_listing_id` from day one.
- Later, sell promoted placements (daily budget, labelled "Promoted") and keep the legacy `featured` flag as `featured_until`.
- Runner-up: a marketplace-attributed commission (Peerspace-style). It lost because of attribution disputes and "double-dipping" optics for an organizer-paid SaaS.

## 3. Cross-tenant search architecture consistent with RLS

**Principle: the marketplace never reads tenant tables.** The RLS boundary is a **public read model**, not the search engine.

- **Projection table.** `marketplace.public_listings` holds `entity_type` (event/organizer/venue), `org_id`, `canonical_url`, title/summary per locale, `category_ids`, `start_at`/`end_at`/`tz`, `_geo`, `price_min`/`price_max`/`currency`, `is_free`, `is_online`, image variants, `quality_score`, `promoted_until`, `status` and `content_hash`.
- **How it is written.** A worker subscribed to outbox events (`event.published/updated/cancelled`, `org.suspended`, `listing.flag_changed`) writes it. The worker runs as a dedicated `marketplace_projector` DB role with SELECT on the source tables and write access to the projection only.
- **Public web and mobile access.** They get SELECT on the projection only. Serialization uses a typed allowlist (Zod schema), plus a contract test that fails if any non-allowlisted field appears. This directly prevents a repeat of §0.
- **Search engine: Meilisearch v1.54.0 (2026-09-21).**
  - Public indexes `public_events`, `public_venues` and `public_organizers` are fed **only from the projection**. Use a search-only key restricted to those indexes; no tenant token is needed because the data is public by construction.
  - Tenant admin search (attendees, orders) uses separate indexes with **tenant tokens** embedding `org_id = X`. Meilisearch documents tenant tokens as RLS-equivalent for the search endpoint only.
  - Geo: `_geoRadius`, `_geoBoundingBox` and `_geoPolygon` for filters; sort with `_geoPoint(lat,lng):asc`.
  - `localizedAttributes` covers Arabic, CJK and Hindi tokenization.
  - Facets: category, date bucket, price, free, online, language.
  - Cloud from $20/mo; self-hosting is MIT. Sharding and "dynamic search rules" are listed as Enterprise, so implement pinning of promoted results in the application (edition split UNVERIFIED).
- **Ranking.** Default rules, then `sort`, then custom `quality_score:desc` and `start_at:asc`. `quality_score` is computed nightly from sales velocity, view-to-order conversion, org followers (the Humanitix signal), content completeness and trust. Promoted results are injected into fixed slots, never mixed into the score.
- **Recommendations.**
  - v1 is rule-based: same city and category, upcoming, popular, and "from organizers/venues you follow".
  - v2 uses Meilisearch hybrid/embedding "similar events".
  - Only **platform-level consumer data** (the yayatoh.com account: follows, own purchases) with consent. Never tenant CRM data.
- **Runners-up.**
  - Typesense 30.x (scoped keys with embedded `filter_by`) is equivalent. It lost only on Laravel Scout continuity and team familiarity (UNVERIFIED preference).
  - Algolia lost on cost.
  - OpenSearch lost on operational burden.
  - At current volume, Postgres FTS + PostGIS on the same projection is an acceptable launch fallback, because the projection is the stable contract.

## 4. SEO rules: canonical ownership between tenant domain and marketplace

**Verified Google facts**
- Canonical signal strength: redirect > `rel=canonical` > sitemap. Canonical is "a hint, not a rule".
- For syndicated copies Google recommends **noindex on the copy**, not a cross-domain canonical.
- Language versions are duplicates if only header/footer is translated.
- hreflang must be self-referencing and reciprocal; alternates may be cross-domain.
- Event markup: one event per leaf URL; no markup on listing pages. Required: `name`, `startDate`, `location` + `address`. Recommended images are 16:9, 4:3 and 1:1 at ≥720px wide. Doc updated 2026-09-08 with no deprecation.
- The Indexing API is **not** allowed for Event pages (JobPosting/BroadcastEvent only).
- Sitemaps: 50,000 `loc` per sitemap index, 500 indexes per Search Console site (per-file limit 50,000 URLs / 50MB per sitemaps.org). `priority`/`changefreq` are ignored; `lastmod` is used only when accurate.

**Rules**
1. **One home URL per event.** `events.canonical_url` is derived at publish time. Precedence: the org's verified primary custom domain first, otherwise `yayatoh.com/events/{slug}`.
2. **Custom-domain events on the marketplace.**
   - Cards in search, city and category pages link straight to the tenant URL.
   - `yayatoh.com/events/{slug}` **301s** to it by default.
   - Optional org setting `marketplace_detail_mode = mirror` renders a yayatoh.com copy (for app/Yayatoh-account checkout) with **`noindex,follow` plus `rel=canonical`** to the tenant URL, following Google's syndication guidance.
   - The tenant page never canonicalizes to yayatoh.com.
3. **JSON-LD only on the canonical page.**
   - `organizer.url` points to the org profile on the canonical host, and `offers.url` to the canonical checkout.
   - Keep `eventStatus` current and set `previousStartDate` on reschedule.
   - Generate all three image crops automatically.
   - No Event markup on unlisted, private, invitation-only or wedding pages; those are `noindex`.
4. **Listing pages** (`/events/{city}`, `/events/{city}/{category}`).
   - BreadcrumbList only.
   - Indexable only when there are at least 5 upcoming events; otherwise `noindex,follow`. With current inventory, avoid generating city×category pages, because thin programmatic pages are a scaled-content risk.
   - Filter and sort query params canonicalize to the base URL.
5. **Locales.**
   - Move to path prefixes (`/es/...`) and 301 `/lang/{xx}`.
   - Event pages are indexable only in locales where the organizer supplied content (`event_translations`). Other locales render UI-translated with canonical to the primary-language URL.
   - hreflang goes only among genuinely translated versions on the same canonical host, with `x-default` set to the primary language.
6. **Per-host sitemaps and robots.**
   - Serve `robots.ts` and the sitemap per host, resolved from the Host header.
   - yayatoh.com lists only URLs it canonically owns: upcoming events, organizers, venues, eligible city pages and blog.
   - Each tenant domain gets its own sitemap listing its canonical URLs.
   - `lastmod` comes from `content_hash` changes.
   - Next.js 16.3 `generateSitemaps` emits `/sitemap/[id].xml`. Add a route handler that writes the `sitemapindex` (Next not auto-generating an index is UNVERIFIED for 16.3).
7. **Past events** stay live with status 200, an "ended" state and the organizer's upcoming events. Remove them from sitemaps immediately and `noindex` them after 12 months (policy choice, not a Google rule).
8. **Search Console and IndexNow.**
   - The platform controls `<head>`, so auto-verify each custom domain as a **URL-prefix property via a meta tag**, then submit sitemaps through the Search Console API.
   - Serve a per-host IndexNow key file (10,000 URLs per POST) for Bing and other participating engines.
   - The per-account Search Console property limit is UNVERIFIED; check it before scaling.
9. **Domain lapse.** If a custom domain fails its health or verification check for more than 7 days, revert `canonical_url` to the yayatoh.com path and alert the org.
10. **Legacy redirects.**
    - A `slug_redirects` table covers `/e/{short}`, `/events/{slug}/tag_{tag}` and `/lang/{xx}`.
    - Move organizer profiles from the root catch-all to `/o/{slug}`, with a 301 from old root paths via lookup. This frees the root namespace for marketing and locale paths.
    - Keep `/events/{slug}` and `/venues/{slug}` stable.

## 5. Venue module design

**How venue-centric platforms do it**
- **Cvent Event Diagramming (Social Tables):**
  - To-scale rooms from DWG/CAD/PDF.
  - The venue shares via secure view/edit links without the planner needing an account.
  - A catalogue of the venue's *actual* furniture inventory constrains layouts.
  - Cvent Supplier Network: listing is free for venues and planners, with a paid "Diamond" upgrade for placement.
- **Tripleseat Floorplans:**
  - Venue-owned 2D/3D templates.
  - Permissioned collaborators (clients, planners, vendors).
  - Layouts are tied to the event record.
  - Standalone from $150/month.
- **Prismm (AllSeated):** a crowd-reused library of 150,000+ venue floor plans.
- **Peerspace:** free listing, 20% host fee, and Instant Book ranks higher.

**Recommended model**
- **`places`** (platform-owned, not tenant-scoped): address, geo, timezone, external place id, dedupe key. Every event references a place.
- **`venue_profiles`**:
  - Public directory entry: slug, description, amenities, capacities by setup, photos, quote form.
  - `owner_org_id` is **nullable**, meaning the profile is unclaimed and platform-managed.
  - Claim flow (`venue_claims`) with domain-email or document verification.
- **Venue as a light tenant type.** `organizations.type = 'venue'` uses the same RLS and auth. It gets a slim portal: Profile | Spaces & Layouts | Inquiries | Calendar | Events | Team (vision §12). Venues can run their **own events** through the normal events module.
- **Layout library.**
  - `venue_spaces` (rooms), then `venue_layouts`, then **immutable** `venue_layout_versions` (room shell, fixed objects, exits, stage, named setups such as "Banquet 30×10-top" or "Theater 420", and capacity).
  - Sharing via `layout_grants(layout_id, grantee_org_id | PUBLIC)`.
  - An organizer **forks** a version into the event's `seating_chart` (`source_layout_version_id`) through a SECURITY DEFINER `clone_layout()` function. This is the only sanctioned cross-tenant read.
  - Never live-link: a venue edit must not move sold reserved seats. Show "venue layout updated" as an opt-in re-fork.
- **Quote requests.** `venue_inquiries` (date, headcount, budget, event type, messages) with a pipeline of new → contacted → proposal → won/lost.
  - RLS-visible to `venue_org_id`, and to `requester_org_id` when the requester is an org.
  - Unclaimed venues route to a platform-ops inbox with a "claim this venue" email.
- **Event collaboration.** `event_collaborators(event_id, org_id, role='venue')` grants run-of-show, headcount and layout access, **not** attendee PII.

**Timing**
- **At launch:**
  - Ship the full data model: places, venue_profiles, layout-version and fork columns.
  - Migrate existing venues into unclaimed profiles, keeping `/venues/{slug}` and request-a-quote.
- **Launch +1–2 quarters:** the venue org type, claim flow, portal and shared layout library, *after* the seating engine's geometry schema is frozen.
- **Later:** paid venue plans (featured placement, availability calendar, CRM integrations such as Tripleseat).
- **Runners-up:**
  - Org-owned venues only (status quo): lost because every organizer duplicates the same hall and quotes never reach the real venue.
  - Full venue portal at launch: lost because it depends on the seating editor, and venue inventory is small.



## Key recommendations

- Incident first: the live public endpoint /events/api/get_events returns organizer user records whose field names include bank_account_number, mailchimp_apikey, magic_login_token and stripe_account_id. Hide the fields, rotate keys and review logs now, independent of the rebuild.
- Split visibility (public/unlisted/private), marketplace_listing (inherit/on/off against an org-level enrollment) and search_indexing into three flags. Eventbrite-style conflation breaks the white-label use case.
- Default to marketplace opt-out for self-serve orgs, opt-in for white-label/custom-domain orgs, and always unlisted for wedding and private-social templates. Record terms version, user and time as consent.
- Charge no marketplace listing fee at launch. Record orders.acquisition_channel and referrer_listing_id from day one, then monetize later with labelled promoted placements (the Eventbrite Ads model) rather than a commission.
- Gate eligibility the way Luma does: checkout must be on Yayatoh, the place geocoded, image at least 1200px, category and description set, Stripe KYC or ID verified. The first event from a new org goes to moderation.
- Build a whitelisted public read model (marketplace.public_listings) written by an outbox worker under a dedicated DB role. Public web, apps and Meilisearch read only from it, and contract tests block non-allowlisted fields.
- Use Meilisearch v1.54 public indexes (geoRadius/geoPoint, facets, localizedAttributes for 12 languages) fed from the projection, and separate tenant-token indexes for admin search. Typesense 30.x is the runner-up; Postgres FTS+PostGIS is an acceptable launch fallback.
- Give each event one home URL: the verified custom domain wins, otherwise yayatoh.com/events/{slug}. The marketplace 301s to the tenant URL, or in mirror mode serves noindex,follow plus rel=canonical. Tenant pages never canonicalize to yayatoh.com.
- Emit Event JSON-LD only on the canonical page (auto-generate 16:9, 4:3 and 1:1 images; keep eventStatus and previousStartDate current). Listing pages get BreadcrumbList only and are noindex below 5 upcoming events.
- Replace session /lang/{xx} with path locales. Make event pages indexable only in locales the organizer actually translated (Google treats chrome-only translations as duplicates), with hreflang among real translations only.
- Serve robots.txt and sitemaps per host. Auto-verify tenant domains in Search Console with a platform-served meta tag, submit via the API, add IndexNow, and do not use the Google Indexing API for events. Preserve legacy URLs through a slug_redirects table and move root /{organisation_url} to /o/{slug}.
- Venues: ship the data model at launch (platform-owned places, claimable venue_profiles, immutable layout versions forked into event seating charts). Ship the venue org type, portal and shared layout library 1-2 quarters later, once the seating geometry schema is frozen.


## Data model implications

- organizations.type enum (organizer | agency | venue | platform); organizations.marketplace_status (not_enrolled | enrolled | suspended), marketplace_terms_version, marketplace_enrolled_by, marketplace_enrolled_at, verification_status, trust_score
- org_domains(host, org_id, is_primary, verified_at, health_status, last_checked_at, gsc_verification_token, indexnow_key, marketplace_detail_mode redirect|mirror)
- events.visibility (public|unlisted|private + password_hash), events.marketplace_listing (inherit|on|off), events.search_indexing, events.canonical_url (derived), events.primary_locale, events.place_id, events.venue_space_id, events.seating_chart_id, events.featured_until
- event_translations(event_id, locale, title, summary, description, is_indexable) to drive hreflang and locale indexability
- marketplace.public_listings projection (entity_type, entity_id, org_id, canonical_url, localized title/summary, category_ids, start_at, end_at, tz, geo, price_min, price_max, currency, is_free, is_online, image variants, quality_score, promoted_until, status, content_hash, updated_at), writable only by the marketplace_projector role
- outbox_events table driving the projection and search indexing (event.published/updated/cancelled, org.suspended, listing.flag_changed)
- marketplace_moderation(listing_id, reason, flags, reviewer_id, decision, decided_at) and promoted_placements(org_id, event_id, slot, daily_budget, start_at, end_at, impressions, clicks, spend)
- orders.acquisition_channel (marketplace|tenant_site|app|direct|partner) and orders.referrer_listing_id
- slug_redirects(host, old_path, target_url, http_status, created_at) covering /e/{short}, /events/{slug}/tag_{tag}, /lang/{xx} and root /{organisation_url} to /o/{slug}
- categories and cities as platform-level taxonomies with translations; city landing-page eligibility derived from upcoming-listing counts
- places (platform-owned: address, geo, timezone, external_place_id, dedupe_key), not tenant-scoped
- venue_profiles(place_id, owner_org_id NULLABLE for unclaimed, slug, description, amenities, capacities, photos, claim_status) and venue_claims(venue_profile_id, claimant_org_id, evidence, status)
- venue_spaces, venue_layouts, immutable venue_layout_versions (geometry JSON, fixed objects, named setups, capacity), layout_grants(layout_id, grantee_org_id or PUBLIC); seating_charts.source_layout_version_id for fork provenance
- venue_inquiries(venue_profile_id, venue_org_id, requester_user_id, requester_org_id NULLABLE, event_date, headcount, budget, event_type, status pipeline, messages) with dual-party RLS
- event_collaborators(event_id, org_id, role venue|co_host, permissions) granting run-of-show and layout access without attendee PII
- platform-level consumer graph: follows(user_id, org_id|venue_profile_id), consumer_recommendation_consent; kept separate from tenant-owned attendee CRM


## Risks

- CRITICAL, live today: the unauthenticated /events/api/get_events response includes organizer user fields named bank_account_number, mailchimp_apikey, magic_login_token, fcm_token, apn_token, stripe_account_id, email, phone, ip_address and taxpayer_number, plus e_admin_commission. Values were not inspected; treat it as an incident until verified.
- A cross-tenant data leak through the public projection if serialization is not allowlisted; the same failure mode as the live incident.
- Canonical drift: a tenant changes or loses its custom domain, leaving canonical and JSON-LD pointing at a dead host. This needs domain health checks and automatic fallback.
- Mirror-mode pages rely on noindex; if misconfigured to indexable with only a cross-domain canonical, Google may pick the yayatoh.com copy (canonical is a hint) and anger white-label customers.
- Very low inventory (2 upcoming public events, about 4 venues): programmatic city and category pages would be thin and a scaled-content spam risk, and the marketplace has little liquidity to justify heavy investment yet.
- Duplicate content across 12 locales if UI-only translations are indexed (Google treats them as duplicates).
- Fraudulent or scam events on an open marketplace. This needs moderation of first events, KYC and payout holds for new orgs.
- Channel conflict: white-label customers seeing competitor events next to theirs if marketplace enrollment defaults on for them.
- Forked venue layouts diverge from the venue's master; live-linking instead would corrupt sold reserved-seat inventory.
- Venue claim impersonation, and ownership disputes over the platform-managed unclaimed directory.
- Search Console per-account property limits and API quotas when auto-verifying many tenant domains (UNVERIFIED limits).
- Mobile apps depend on /api/v2/organiser/{organisation_url} and the events list; moving to projection-backed endpoints and /o/{slug} must keep those contracts.
- Meilisearch features such as dynamic search rules and sharding may be Enterprise-only (UNVERIFIED); promoted-result pinning may need application-side logic.


## Open questions

- Can you confirm whether the exposed fields in the public events API contain real values (bank details, Mailchimp keys, login tokens), and who will own the incident response and key rotation?
- Is the yayatoh.com marketplace meant to become a consumer-facing growth channel, or is Yayatoh primarily B2B SaaS with discovery as a secondary benefit? This sets how much to invest in ranking, recommendations and promoted placements.
- Should white-label plans be allowed to join the marketplace at all, and should they be able to hide 'Powered by Yayatoh'?
- For custom-domain events listed on yayatoh.com, should checkout hand off to the tenant domain (redirect) or stay on yayatoh.com with the Yayatoh consumer account and apps (mirror mode)?
- Will organizers also get Yayatoh subdomains (org.yayatoh.com), or only yayatoh.com paths plus optional custom domains?
- Are current public organizers comfortable being auto-enrolled in the marketplace at migration (grandfathered with notice), or must everyone opt in again?
- Would you ever charge a marketplace-attributed commission, or only sell promoted placements and featured slots?
- Who created the existing venue records (organizers or venue owners), where do request-a-quote submissions go today, and how many arrive per month?
- Are there venue operators ready to be design partners for a venue portal and layout library, and would they pay for it (Tripleseat Floorplans starts at $150/month)?
- What geographic scope applies at launch (Maryland/DC only, or national), and which city pages should exist?
- Which languages do organizers actually write event content in, and is machine translation of event descriptions acceptable and indexable?
- Should wedding and private-social events ever appear in the directory or have public pages indexed?
- Should the mobile apps show only marketplace-listed events, or also unlisted events opened by link or code?


## Sources

- Local vision doc: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
- Live site inspection (read-only GETs): https://yayatoh.com/ , https://yayatoh.com/events , https://yayatoh.com/events/api/get_events , https://yayatoh.com/events/eec-gala , https://yayatoh.com/venues/tinley-convention-center (embedded Ziggy route table)
- https://developers.google.com/search/docs/appearance/structured-data/event (updated 2026-09-08)
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls (updated 2026-07-10)
- https://developers.google.com/search/docs/crawling-indexing/canonicalization (updated 2026-08-20)
- https://searchengineland.com/google-no-longer-recommends-canonical-tags-for-syndicated-content-406491
- https://developers.google.com/search/docs/specialty/international/localized-versions (updated 2026-09-21)
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps (updated 2025-12-10)
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap (updated 2026-07-08)
- https://developers.google.com/search/apis/indexing-api/v3/quickstart (updated 2026-07-16)
- https://support.google.com/webmasters/answer/9008080
- https://www.indexnow.org/documentation
- https://developers.google.com/search/case-studies/eventbrite-case-study
- https://www.eventbrite.com/help/en-us/articles/305873/how-to-manage-the-privacy-settings-for-your-event/
- https://www.eventbrite.com/help/en-us/articles/470861/why-isn-t-my-event-showing-in-search/
- https://www.eventbrite.com/organizer/features/eventbrite-ads/
- https://www.eventbrite.co.uk/blog/academy/eventbrites-distribution-partners-fds00/
- https://www.ticketnews.com/2026/03/bending-spoons-finalizes-purchase-of-eventbrite/
- https://help.luma.com/p/featuring-your-event-on-luma
- https://help.luma.com/p/submitting-events-to-calendars
- https://help.luma.com/p/luma-plus
- https://help.humanitix.com/en/articles/8950908-what-is-the-difference-between-a-public-and-private-event
- https://help.humanitix.com/en/articles/11425786-how-to-improve-your-event-s-visiblity-on-humanitix
- https://help.humanitix.com/en/articles/9970883-why-is-my-event-not-appearing-in-google-searches
- https://humanitix.com/us/pricing
- https://help.tickettailor.com/en/articles/6521686-will-my-event-show-up-on-google-search (search snippet; direct fetch 403)
- https://help.tickettailor.com/en/articles/6758421-how-can-i-add-my-custom-domain-to-my-box-office (search snippet; direct fetch 403)
- https://www.tickettailor.com/discover
- https://dicefm.zendesk.com/hc/en-gb/articles/18497498802705-Connect-Spotify-or-Apple-Music
- https://musically.com/2025/06/05/fever-acquires-ticketing-firm-dice-in-live-tech-consolidation/
- https://www.cvent.com/en/supplier-venue/event-diagramming-software
- https://www.cvent.com/en/supplier-venue/advertising
- https://www.cvent.com/en/event-marketing-management/cvent-supplier-network
- https://floorplans.tripleseat.com/info/venues
- https://tripleseat.com/features/floor-plans/
- https://www.prismm.com/solutions/event-design-software/floor-planning-software-venues-planners-vendors
- https://support.peerspace.com/en/articles/10119442-what-is-the-peerspace-service-fee (search snippet; direct fetch 403)
- https://www.meilisearch.com/docs/learn/security/multitenancy_tenant_tokens
- https://www.meilisearch.com/docs/learn/filtering_and_sorting/geosearch
- https://www.meilisearch.com/docs/reference/api/settings#localized-attributes
- https://github.com/meilisearch/meilisearch/releases (v1.54.0, 2026-09-21)
- https://www.meilisearch.com/pricing
- https://typesense.org/docs/guide/data-access-control.html
- https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps (Next.js 16.3.6 docs)
- https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap (Next.js 16.3.6 docs, updated 2026-08-25)
