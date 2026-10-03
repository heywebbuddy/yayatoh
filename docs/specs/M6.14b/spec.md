# Spec: M6.14b — Venues

- **Milestone:** M6.14b (roadmap Phase 6, M6.14 "Marketplace and venues v2"; plan `docs/plans/phase-6.md` row M6.14b)
- **Status:** built (2026-10-03), behind the `advanced_seating` entitlement and the `PROMOTED_PLACEMENTS` flag
- **Risk tags:** `db-migration`, **`tenancy`** (venue ↔ organizer sharing): **owner approval before main**
- **Related:** P6-1 (behind flags), P6-11 (venue portal, shared layouts, promoted placements), P6-13 (entitlements); M6.11b (venue layout library, revisions), M6.14a (SearchIndex port, `/search`); roadmap §4.1 (`org_relationships` … `venue_partner`)

## 1. Goal and users
Venues keep the floor plans of their rooms and want the organizers who book them to start from
the right plan. A venue names the organizers it works with, shares chosen plans with them, and
sees which events use them. Organizers get those plans in their seating library and copy one into
an event. Separately, organizers can promote a marketplace listing in search (free in beta).

## 2. What was built
**Venue portal** (`/o/{org}/venue-portal`, sidebar Events → Venue portal; `advanced_seating`):
- **Partners** (`tenancy.addVenuePartner` / `removeVenuePartner` / `venuePartners`): the venue adds
  an organizer by its address (the slug, or a pasted `/o/{slug}` link); unknown, suspended and
  terminated orgs answer the same `not_found`; itself is refused. A partner is a `venue_partner`
  row in `tenancy.org_relationships` (parent = venue, child = organizer, source `venue_portal`);
  removing it sets `detached_at` (a state change); adding again clears it. Owners/admins
  (`org:update`); the list reads with `events:read` through `tenancy.venue_partners()`.
- **Sharing** (`seating.shareLayout` / `unshareLayout`, `org:update`): a plan of the venue's
  library × a partner (`seating.layout_shares`, unshare deletes). Only active partners, only the
  venue's own plans (RLS).
- **Uses** (`seating.venuePortal`, `events:read`): partners, plans with whom each is shared and how
  many partner events use it, and the events using the venue's plans through
  `seating.venue_layout_uses()`: plan, organizer name, event name, start and time zone, status,
  used at — nothing else.
- Viewers read the portal with no controls. Empty states say what to do next.

**Organizer side** (`/o/{org}/seating-library`, section "Shared by venues"):
- `seating.sharedLayouts` lists plans shared with the org (`seating.partner_shared_layouts()`:
  plan name, seats, venue name/slug, dates). An org with no grant sees nothing.
- `seating.useSharedLayout` (`seating:write`) copies a shared plan into one of the org's events
  (the event plan) through the same path as `seating.setEventLayout` (`applyEventLayoutTx`):
  refused like any plan change once seats are held/sold or the plan is locked. **Copy-on-use**:
  the event keeps its own copy and revisions; the venue's image underlay is dropped (media are
  served only from their own org). Records `seating.shared_layout_uses` (one per event); giving
  the event one of the org's own library plans ends the use. The form says the venue will see the
  event's name, date and status.

**Cross-org reads** (hand-written SECURITY DEFINER functions, granted to `app_user` only): each is
bound to the caller's own tenant (`app.org_id`, set by `withTenant`), never to a parameter naming
another org, and re-checks the share and an active partnership (venue org live) on every call, so
**a revoke or detach applies on the next request**. Allowlisted columns only.

**Promoted placements** (`/o/{org}/promotions`, sidebar Site & content → Promotions):
- `marketplace.promotions` (one per event): `marketplace.promoteListing` (`marketing:write`, 1–30
  days, from now; only listings on the marketplace, never weddings: `not_listed`) and
  `marketplace.endPromotion`; `marketplace.promotions` lists the org's public listings with their
  state (none, scheduled, active, ended).
- Search (`/search`, page 1): `promotedPlacements` takes running promotions
  (`marketplace.promoted_slugs(now)`: marketplace listings of live orgs, never weddings, not
  ended) that also match the visitor's query and filters (one multi-search round trip), at most
  `PROMOTED_SLOTS` = 2, hydrated from the public read model, shown in a "Promoted" section above
  the results with a "Promoted" tag on every card. Cached in the marketplace scope; promoting or
  ending revalidates it.
- **Flag** `PROMOTED_PLACEMENTS` (on/off wins; unset = on only in dev/CI, off in production).
  Nothing is charged (priced later, P6-13).

## 3. Later / not yet
- Restricting the portal to orgs of kind `venue`; organizer-side consent or "leave partnership".
- Sharing a plan's revisions or pushing a venue's update to events that opted in.
- Copying the venue's floor plan image (needs a cross-org media grant).
- Venue profiles and venue pages in the marketplace (claimable venue directory).
- Pricing, caps and staff review of promotions; promoted venues; placements in `/events` and recommendations.
- Indexes keyed by the partner/venue org for the definer lookups (small tables today).

## 4. Acceptance
| Criterion | Test |
|---|---|
| A venue sees only its own layouts and the events that use them (allowlisted columns only) | `packages/testing/tests/venues-portal.int.test.ts` ("the partner copies it…", allowlist key sets; "Org b's view as a venue never shows org a's events"); `apps/web/e2e/venue-portal.spec.ts` (uses table) |
| An organizer without a grant can't see a venue's private layouts | int: "a partner sees the shared plan…; an org without a grant sees none" (list, definer doc by guessed id, RLS on tables, use refused); e2e: "a viewer reads the portal…; an organizer without a grant sees no private plan" |
| Revokes apply on the next request | int: "unsharing applies on the next request", "removing the partner withdraws every share…"; e2e: unshare then organizer reload |
| Copy-on-use; the event keeps its own revision | int: "the event keeps its own copy", "giving the event one of the organizer's own plans ends the use" |
| Promoted placements are labelled as promoted | int: "promoted placements" (flag, matching only, page 1, end); e2e: "an org promotes a marketplace listing; search labels it Promoted…" |
| E2E: venue shares a layout, organizer uses it, venue sees the usage; keyboard only, axe both themes, RTL | `apps/web/e2e/venue-portal.spec.ts` (375/768/1280) |
| Isolation and canary for the new tables | fixtures rows for both orgs (`createOrgFixture`), `isolation.int.test.ts`, `canary.int.test.ts` |
