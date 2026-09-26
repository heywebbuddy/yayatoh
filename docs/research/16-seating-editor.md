# Seating Editor

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** Redis Lua seat holds. Holds live in Postgres (docs/roadmap.md §5.2).


## Topic

Visual seating — floor plan editor, seat selection during ticket purchase, guest assignment, seat finder, intelligent seating

# Visual Seating for Yayatoh 2.0 — Research Report

Date: 2026-09-26. Grounded in the vision document (section 6 "Weddings, Galas and Social Events", section 10 "Improve Seating", section 12 "different event types", section 13 "modular"). Seating is called out as a *flagship* feature and the vision explicitly asks for tables, seats, sections, stages, booths, entrances, dance floors, custom objects, drag-and-drop, guest/group assignment, seat lookup, interactive floor maps, and future "intelligent seating assistance" ("keep association members together", "VIP tables closest to the stage").

## 1. Build vs. embed (seats.io)

**seats.io** is the only serious embeddable option. Verified facts (seats.io/pricing, 2026):

| Plan | Commitment | Included used seats | Overage |
|---|---|---|---|
| Silver | €450/yr prepaid | 2,500/yr | €0.18 |
| Gold | €600/mo or €7,200/yr | 5,000/mo or 60,000/yr | €0.12 |
| Diamond → Rhodium | 20k → 500k seats/mo | — | €0.10 → €0.05 |

A "used seat" is billed once per event when it is selected (and not deselected), status-changed via API, or assigned to a channel. Unused commitment does not roll over. 90-day trial. Features: designer with sections/rows/tables/GA areas, floor-plan image "scan", 2D→3D, white-label designer embed, hold tokens (default 15 min, `expiresInMinutes` configurable), best-available cascade, `noOrphanSeats` validator (with `lenient` mode), multilevel pricing (categories × ticket types passed at render time; the chart stores only category key/name/colour), resale, 99.99% uptime SLA.

Worked cost: 300 events/yr × 400 seats = 120k used seats/yr → Gold yearly €7,200 + 60k × €0.12 = **~€14,400/yr**, and every wedding/gala seat (zero ticket revenue) is billed the same as a sold concert seat. Lock-in: chart geometry lives in seats.io, the buyer UI is their iframe/renderer (white-label limits), multi-tenant isolation depends on their workspaces feature (UNVERIFIED for per-tenant billing), and the guest-assignment/gala workflow is not their product.

**Recommendation: build.** Seating already exists in the Laravel app (existing data can be migrated), it is a stated differentiator, and the wedding/gala segment has no per-seat revenue to absorb a per-seat fee. Copy seats.io's *API semantics* (hold tokens, best-available cascade, orphan validator, categories × ticket types, channels) as the design reference. Runner-up: seats.io as a stop-gap for a stadium-scale customer (>30k seats) — Yayatoh's segment (galas, theaters, conferences, churches) does not need it.

## 2. Rendering technology (verified versions as of 2026-09)

| Option | Version / date | License | Size (min / gz) | Verdict |
|---|---|---|---|---|
| **Konva + react-konva** | 10.7.0 (2026-09-23) / 19.3.0 | MIT | 186 KB / 55 KB | **Recommended** |
| PixiJS + @pixi/react | 8.21.0 (2026-09-17) / 8.0.5 (Dec 2025) | MIT | 891 KB / 255 KB | Runner-up for 50k+ seats |
| Fabric.js | 7.4.0 (2026) | MIT | 299 KB / 92 KB | No |
| tldraw SDK | 5.4.2 | Proprietary, source-available | large | No |
| SVG + d3-zoom | 3.0.0 | ISC | tiny | Yes, for print/export and small static views |
| Custom Canvas/WebGL | — | — | — | Only as internal optimisation inside Konva |

**Why Konva.** Actively released (five releases in September 2026 alone; 10.5 added `Stage.eventBatchFunc()` for framework integration and Transformer speedups with many selected nodes; 10.7 added isolated groups and faster translucent fills). It ships the editor primitives we need out of the box: `Transformer` with `rotationSnaps`/`rotationSnapTolerance`, multi-select, a documented object-snapping recipe (edge/center guides, ~5 px tolerance), a drag-layer pattern, and a multi-touch pinch-zoom recipe (`Konva.hitOnDragEnabled`). Official demos render 20,000 draggable nodes (event delegation on the Stage, dedicated drag/tooltip layers) and a 10,000-shape drag stress test. react-konva major must match the React major (19.x now); it is browser-only, so in Next.js it must be loaded with `next/dynamic({ ssr: false })` inside a `'use client'` component.

Scale strategy (needed for 5,000–20,000 seats): do **not** create one Konva node per seat. Model *sections/tables/objects* as Konva nodes (they get Transformer, drag, snapping) and render the seats of each section/table as a **single custom `Konva.Shape`** whose `sceneFunc` draws all seats in one pass with a level-of-detail switch (dots below ~0.4 zoom, circles + labels above), and whose `hitFunc` uses a flat spatial index (grid or RBush) to resolve pointer→seat. This is the same "batch per section" approach seatmap.pro describes for Canvas (their guidance: SVG <1,000 seats, Canvas 1,000–50,000, WebGL 50,000+). Respect Konva's stated memory guidance: each layer ≈41 MB at 1080p retina and Mobile Safari caps canvas memory at 256–384 MB, so keep to 2–3 layers (static, interactive, overlay), cap `pixelRatio` at 2, and cull off-screen sections with `visible(false)`.

**Why not the others.** PixiJS is the right engine for stadium scale and WebGPU, but @pixi/react 8.0.5 lags core (last release Dec 2025, React ≥19 only), the bundle is 4.6× Konva gzipped, there is no built-in Transformer/snapping/selection, and WebGPU is not Baseline (caniuse: Chrome/Edge 113+, Safari 26+ partial, Firefox off by default; 87% global) — PixiJS falls back to WebGL, and only got an experimental Canvas renderer in 8.18 (Apr 2026). Fabric.js is an image/design editor (per-object controls and retained-mode objects scale poorly past a few thousand), and had two 2026 SVG-export XSS CVEs (CVE-2026-27013, CVE-2026-44311) — relevant because we would export layouts. tldraw is "not permissively licensed… would not be Open Source by any definition"; production requires a license key, the hobby license carries a watermark, commercial pricing is quote-based ("value-based"), and its whiteboard semantics (freehand, arrows, sticky notes) are the wrong abstraction for seat inventory. Plain SVG hits DOM limits (community benchmarks: lag beyond ~5,000 nodes), but it is ideal for server-side exports (PDF signage, printable seating chart, email thumbnails) because it needs no browser.

**How incumbents do it.** Eventbrite's reserved-seating system (Core77 design award entry) is built with "JavaScript, WebGL, Python, and Redis"; its designer offers preset layouts or blank canvas, sections/tables/objects/text, mandatory price tiers, holds with access codes, optional pick-a-seat with a "best available" fallback, 100–100,000 seats per map — and **cannot create or edit a map on a mobile device** (a gap Yayatoh can exploit with a tablet-capable editor). Ticketmaster's ISM offers offer-type and accessibility filters, a price slider, "Lowest Price / Best Seats" shortcuts, and does not reserve until checkout; Ticketmaster reports +17% tickets/order, +16% in-cart conversion, +38% AOV when ISM is on from the first minute of onsale (EMEA, since Q1'25). Ticketmaster's rendering stack is UNVERIFIED. Cvent Event Diagramming (ex-Social Tables; Cvent bought Prismm/Allseated in Apr 2025 and is retiring it by June 2027) sells CAD/DWG/PDF-to-scale import, 700+ objects, real-time collaboration, a "Diagram Assistant" that auto-arranges seating/tables, meal-preference tracking and 3D renders — that is the enterprise bar for the *diagramming* side, not needed in phase 1.

## 3. Floor-plan data model

Hierarchy: **Venue → Layout (reusable, versioned template) → Event Layout (per-event fork) → Sections → Tables/Rows → Seats, plus Objects.**

- `venues` (tenant_id, name, address, default_units). `layouts` (tenant_id, venue_id nullable for freestanding templates, name, `is_template`, `current_version`). `layout_versions` (layout_id, version, `document` JSONB, `published_at`, `created_by`, `checksum`). The JSONB document is what the editor loads in one request; it is the geometry source of truth for rendering.
- `event_layouts` (event_id, source_layout_version_id, `document` JSONB, `status` draft|published|locked, `revision`). Publishing snapshots the template; once tickets are sold the event layout is *locked*: only non-destructive edits (relabel, add seats, block/unblock, move objects) are allowed and each creates a new revision. Seat identity is a stable `seat_uuid` carried through every revision so orders never dangle; human labels (section/row/seat) are display data, never keys.
- **Sections** (`kind`: reserved_rows | tables | general_admission | non_sellable), each with transform (x, y, rotation), `focal_point_rank` inputs, `price_category_key`, optional `channel_key`, `ga_capacity`.
- **Tables**: `shape` round|rect|square|half_round|custom(polygon), `seat_count`, `seat_numbering` {start, direction cw|ccw, prefix, skip_list}, `bookable_as` whole|by_seat, `head_table`, `min_party`. Round/rect seat positions are generated from the table geometry (radius / side counts), custom tables store explicit seat offsets.
- **Rows**: `label`, `curve` (arc radius or null), `seat_spacing`, `numbering` {start, step 1|2 for odd/even, direction, prefix}; seats generated then materialised.
- **Seats**: `seat_uuid`, `label`, local (x, y), `accessibility` none|wheelchair|companion|aisle|limited_mobility, `restricted_view`, `price_category_override`, `tags`.
- **Objects**: stage, booth, entrance, exit, dance_floor, bar, buffet, restroom, pillar (obstacle), label, image (uploaded floor-plan underlay with opacity/scale), custom polygon. Each has transform + `is_obstacle` (used later for path routing) + `is_focal_point` (stage marked focal drives "best" and "VIP near stage").
- **Coordinates & units**: world space in **centimetres** (integers, origin top-left, y down), `layout.scale_px_per_cm` for display, rotation in degrees. Real units let the editor support to-scale mode (later CAD/PDF underlay) and ADA/fire-code checks; seat radius default 25 cm.
- **Normalised inventory** is separate from geometry: `event_seats` (event_id, seat_uuid, section_id, price_category, status, hold_token, order_item_id, `quality_score`, accessibility) with unique (event_id, seat_uuid). Geometry lives in JSONB; inventory lives in rows. This is what seats.io does too (chart holds key/name/colour; prices come from the event).
- **Capacity derivation**: `capacity = Σ reserved seats (status ≠ blocked) + Σ GA section capacities`; the Command Center compares this to `event.capacity` and to tickets issued, and raises the "37 attendees have no seat" alert (vision §7) from `attendees LEFT JOIN assignments`.

Modules that only need tables (weddings) see `kind=tables` sections and never row/seat tooling (vision §12).

## 4. Seat selection for sales

- **Status model**: available → held (Redis, TTL) → reserved (order pending payment, DB) → sold; plus blocked, comp, resale, and `channel`-restricted. Postgres is the source of truth for reserved/sold; Redis owns transient holds.
- **Holds**: `SET hold:{eventId}:{seatUuid} {cartToken} NX EX 600` per seat, wrapped in a **Lua script that holds N seats all-or-nothing** and fails fast if any seat is taken (pattern documented by hellointerview and oneuptime 2026; Eventbrite uses Redis for the same role). Default TTL 10 minutes (seats.io default is 15; Ticketmaster-style designs use ~10), extended to 15 when payment starts. Maintain `holds:{eventId}` ZSET scored by expiry so the map can show "held" without scanning keys; a reconciler job clears stale holds because Redis keyspace expiry events are not guaranteed under load. Release validates the cart token so one client cannot free another's hold. Confirm = single Postgres transaction with `SELECT … FOR UPDATE` on `event_seats` + unique constraint; a lost race after payment triggers an automatic Stripe refund.
- **Real-time availability**: Redis pub/sub → SSE (or WebSocket) channel per event broadcasting `{seatUuid, status, version}` deltas; the client keeps a monotonically increasing version and refetches a snapshot if it detects a gap. Also drives the Command Center's live seat metrics.
- **Best available** (mirror seats.io's verified cascade): (1) N adjacent seats in one row without orphans, closest to focal point; (2) same allowing orphans; (3) nearest seats regardless of row avoiding isolated singles; (4) across sections; (5) whole tables; (6) a single GA area; else 400. Inputs: `number`, `categories`, `sections`, `ticketTypes[]`, `accessibleSeats`, `tryToPreventOrphanSeats` (default true), `channelKeys`, `holdToken`. Precompute a per-seat `quality_score` at publish time (distance to focal object, row index, floor rank) so the search is a sorted-scan, not geometry at request time.
- **Orphan rule**: server-side selection validator (`noOrphanSeats`, strict/lenient as seats.io: a single empty seat is allowed only if no alternative selection avoids it) plus client-side hints. Same validator interface later hosts "socially adjacent" rules: seats-between-groups, rows-between-groups, max group size, max occupancy %, one-group-per-table (seats.io's social-distancing rulesets — details of their parameters UNVERIFIED because docs pages 404'd).
- **Pricing**: `price_categories` on the layout (key, name, colour) × `ticket_types` on the event = price matrix (seats.io "multilevel pricing"); optional per-seat override; sections display a pricing overlay; fee-inclusive toggle.
- **ADA (ada.gov ticket-sales rules)**: accessible seats must be sold through the same channels/hours, at no higher price, across price tiers; buyers may add up to **three companion seats contiguous in the same row**; unsold accessible seats may be released to the public only when (a) all non-accessible seats, (b) all in that section, or (c) all in that price tier are sold — implement as a rule engine with an audit log; the map must show the same information for accessible seats. Design counts from the 2010 ADA Standards Table 221.2.1.1 (e.g., 1 space for 4–25 seats, 2 for 26–50, 4 for 51–150, 5 for 151–300, 6 for 301–500, then +1 per 150 up to 5,000) are UNVERIFIED (pages truncated); expose them only as an editor warning, not a hard rule.
- **Channels**: assign seats to `channel_keys` (box office, presale, sponsor allotment); purchase APIs restrict by channel.

## 5. Guest/table assignment (galas, weddings)

Entities: `guests` (tenant CRM person link, name, party_id, tags: vip, association, meal, accessibility_needs, rsvp_status), `guest_groups` (household/party; sizes drive the solver), `assignments` (event_id, guest_id, table_id, seat_uuid nullable, source manual|auto|import), `seating_rules` (event_id, type keep_together|keep_apart|must_sit_at|cannot_sit_at|near_object|far_from_object, subject refs, weight hard|soft:int).

UI: three-pane editor — unseated list (search via Fuse.js 7.5.0, filters by tag/RSVP/party), the Konva map, and a table inspector. Drag a guest onto a table (auto-picks the first free seat, respecting `bookable_as`), onto a specific seat, or drag a whole party; multi-select then "seat at Table 12". Capacity badges per table, conflict highlighting when a rule is violated, unseated counter feeds the Command Center alert. Keyboard path: select guest → type table number → Enter. Exports: CSV/XLSX (guest, table, seat, meal), per-table PDF lists, place cards, escort cards, table-number cards, and a poster-sized seating chart, rendered server-side with @react-pdf/renderer 4.9.0 (MIT) using Avery-style presets; the map thumbnail comes from the SVG serializer.

## 6. Auto-seating

Ship two tiers.

**Tier 1 (default, TypeScript, Web Worker or a Node job):** the two-stage tabu search from Lewis & Carroll, "Creating Seating Plans: A Practical Application" (2016), which powers weddingseatplanner.com. Model guest *groups* as vertices, weights `w>0` = keep apart, `w<0` = keep together; objective `f1` (violations weighted by group sizes) + `f2` (table balance). Stage 1: DSATUR colouring then TABUCOL (20n iterations) to satisfy hard "definitely apart" constraints, incrementing table count if infeasible; Stage 2: tabu search over Kempe-chain interchanges and swaps (tenure 10, 10n iterations) minimising `f1+f2` without re-violating hard constraints. Reported: all runs < 5 s for 50 groups / ~225 guests (max 400 guests) on 2016 hardware, client-side; under a 5-second limit an IP solver produced inferior solutions in every case and feasible solutions in only 112/152 instances. Extend the cost with a proximity term `Σ vip_weight × dist(table, stage)` (the vision's "VIP tables nearest the stage") and per-table capacities. This covers weddings/galas up to ~1,000 guests in seconds.

**Tier 2 (enterprise, later):** Google OR-Tools **CP-SAT 9.15** (Jan 2026, Apache-2.0) in a small Python FastAPI microservice behind the job queue for hard-constraint sets that need infeasibility explanations or optimality (association blocks of 40+ people, sponsor tables, dietary co-location). Model: `x[g,t]` bool, `Σ_t x = 1`, `Σ_g size_g·x[g,t] ≤ cap_t`, keep-apart `x[g,t]+x[h,t] ≤ 1`, must-sit `x[g,t]=1`, objective = weighted violations + proximity; 10–30 s time limit, return best-so-far. Runner-ups: `or-tools-wasm` 0.9.1 (Apache-2.0; CP-SAT in-browser but requires cross-origin-isolation headers and a heavy wasm — attractive later to avoid a Python service), `z3-solver` (SMT, weaker at optimisation), `yalps` 0.6.4 (pure-JS MILP, fine for ≤200 groups), simulated annealing (simple, but the Medium/UNO write-ups show slower convergence than tabu with Kempe moves). Always treat solver output as a *proposal* the planner accepts, edits, or reruns with locked tables.

## 7. Seat finder

Public route per tenant/event with a signed QR (`/find-my-seat/{eventKey}`), no login. Name search: client-side Fuse.js over a cached guest snapshot (≤5k guests; ETag-cached JSON), server-side `pg_trgm` beyond that; optional passcode printed under the QR (seatyourself.io defaults this on), optional "show tablemates" (SeatPlan.io). Also resolve from a ticket QR deep link. Result: table/seat, a mobile map with the table pulsing, an "enter from Main Entrance, stage is ahead-left" hint; path drawing (grid A* around `is_obstacle` objects from the nearest entrance) is a phase-3 nicety. **Kiosk mode**: full-screen route, idle screensaver, PIN-protected exit, service-worker cache of the snapshot so lookups keep working when venue Wi-Fi drops (SeatFound sells exactly this at $49/event or $99/mo white-label; Venued charges $19–60/mo). **TV mode**: rotating alphabetical table lists or sponsor loop. Printing: signage PDF with the QR, table cards, place/escort cards (section 5). Also expose booth lookup for conferences (same index over exhibitor objects).

## 8. Editor accessibility and tablet UX

- Pointer Events + @use-gesture/react 10.3.1 (MIT) for pinch-zoom/rotate/two-finger pan alongside Konva's own pinch recipe; single-finger = pan, tool toggle for marquee select; long-press context menu; handles and snap tolerance defined in *screen* pixels (divide by zoom); 44 px minimum touch targets; arrow-key nudge (1 cm, Shift = 10 cm), duplicate/align/distribute commands, command-stack undo/redo, autosave with optimistic revision numbers, per-tenant object library. Eventbrite has no mobile editing — on-site tablet editing (move a table the morning of the gala) is a visible differentiator.
- Canvas is opaque to screen readers, so every buyer/guest surface ships a parallel **accessible list mode** (section → row → seat listbox with `aria-label` "Row C, Seat 12, Balcony, $45, available", `aria-pressed` selection, `aria-live` announcements) plus a best-available form; this is also the fallback when canvas memory fails on iOS. Status must never rely on colour alone (pattern/shape/icon), meet 3:1 non-text contrast, honour `prefers-reduced-motion`. All labels are data strings so the 12 UI languages work without re-rendering images.

## 9. Phased scope

- **Phase 0 (foundation, ~6 weeks)**: headless `@yayatoh/floorplan` package (schema, generators for rows/tables, capacity, SVG serializer), Konva read-only renderer, Laravel layout import script, `event_seats` inventory + hold service + SSE.
- **Phase 1 (parity, ~10 weeks)**: full editor (sections, tables, rows, objects, snapping, rotation, multi-select, undo, templates), price categories × ticket types, buyer seat picker with holds/orphan validator/list mode, guest drag-and-drop assignment, CSV/XLSX import, QR/name seat finder, basic exports. Replaces existing Yayatoh seating.
- **Phase 2 (~8 weeks)**: best-available cascade, ADA rule engine, channels/box-office holds, Tier-1 auto-seating, kiosk/TV mode, place/table cards, per-event layout revisions with locking, tablet polish, Command Center seating alerts.
- **Phase 3 (later)**: CP-SAT service, path routing, floor-plan image/SVG/CAD underlay tracing, social-distancing rulesets, multi-user collaborative editing (Yjs — need UNVERIFIED), optional 3D/view-from-seat, PixiJS renderer swap only if a 50k-seat customer appears.


## Key recommendations

- Build seating in-house; do not embed seats.io. Its per-used-seat billing (€0.12–0.18 overage, Silver €450/yr for 2,500 seats, Gold €7,200/yr for 60,000) charges the same for zero-revenue wedding seats, and its guest-assignment workflow is not its product. Copy its API semantics (hold tokens, best-available cascade, noOrphanSeats validator, categories × ticket types, channels) as the design reference.
- Use Konva 10.7 + react-konva 19.3 (MIT, 55 KB gz) as the single renderer for editor, buyer picker and seat finder; load it with next/dynamic ssr:false. Runner-up PixiJS 8.21 only if a 50k+ seat customer appears (255 KB gz, @pixi/react lagging, WebGPU not Baseline). Reject tldraw (proprietary, quote-priced, whiteboard semantics) and Fabric.js (image-editor model, 2026 SVG-export CVEs).
- Render seats as one custom Konva.Shape per section/table (batched sceneFunc + spatial-index hitFunc + LOD) rather than one node per seat; keep to 2–3 layers, pixelRatio ≤ 2, cull off-screen sections — this is what makes 5,000–20,000 seats smooth within Mobile Safari's 256–384 MB canvas cap.
- Separate geometry from inventory: layout geometry as versioned JSONB documents (Venue → Layout template → per-event fork with locking after first sale), inventory as normalised event_seats rows keyed by a stable seat_uuid, world units in centimetres with a focal-point object driving 'best' and 'VIP near stage'.
- Implement holds as Redis SET NX EX (10 min, extend to 15 at payment) inside an all-or-nothing Lua script, a ZSET by expiry for map rendering, a reconciler for missed expiries, and Postgres FOR UPDATE + unique constraint on confirm; push availability deltas over SSE from Redis pub/sub.
- Ship best-available as the seats.io 7-step cascade over a precomputed per-seat quality_score, with tryToPreventOrphanSeats default true and a lenient mode, and expose ticketTypes, categories, sections, accessibleSeats and channelKeys parameters.
- Encode ADA ticket-sales rules as a rule engine: same channels/prices for accessible seats, up to three contiguous companion seats, hold-and-release only when all seats / the section / the price tier sells out, with an audit log; show accessibility attributes on the map and in list mode.
- Auto-seating in two tiers: Tier 1 the Lewis & Carroll two-stage tabu search (DSATUR + TABUCOL, then Kempe-chain/swap tabu) in a Web Worker — <5 s for 400 guests — extended with a stage-proximity term; Tier 2 an OR-Tools CP-SAT 9.15 Python microservice for enterprise hard-constraint cases, always returned as an editable proposal.
- Seat finder as a no-login public page per event: signed QR, Fuse.js/pg_trgm name search, optional passcode and tablemates, map highlight, offline-capable kiosk mode with screensaver and PIN exit, TV signage loop, and server-rendered PDFs (signage, place/escort/table cards) via @react-pdf/renderer 4.9.
- Make the editor tablet-first (Pointer Events + @use-gesture 10.3, 44 px targets, screen-space snap tolerances, long-press menus, undo/redo, autosave) — Eventbrite explicitly cannot create or edit seat maps on mobile.
- Every buyer/guest canvas surface must ship a parallel accessible list mode (ARIA listbox, aria-live, status not by colour alone, reduced motion) — canvas alone cannot meet WCAG 2.2 and is also the fallback when canvas memory fails on iOS.
- Deliver in phases: foundation package + inventory/holds → editor + picker + guest drag-drop + seat finder (parity) → best-available, ADA, channels, Tier-1 auto-seating, kiosk, cards → CP-SAT, path routing, floor-plan tracing, collaboration.


## Data model implications

- venues (tenant_id, name, address, default_units) — tenant-scoped; freestanding templates allowed with venue_id null
- layouts + layout_versions (tenant_id, venue_id, name, is_template, version, document JSONB, published_at, checksum) — reusable templates with immutable versions
- event_layouts (event_id, source_layout_version_id, document JSONB, status draft|published|locked, revision) — per-event fork; locked after first sale; only non-destructive revisions afterwards
- Section entity inside the document: kind reserved_rows|tables|general_admission|non_sellable, transform (x,y,rotation), price_category_key, channel_key, ga_capacity
- Table entity: shape round|rect|square|half_round|custom, seat_count, seat_numbering {start, direction, prefix, skip_list}, bookable_as whole|by_seat, head_table flag, explicit seat offsets for custom shapes
- Row entity: label, curve radius, seat_spacing, numbering {start, step 1|2 for odd/even, direction, prefix}; seats materialised from generator
- Seat entity: stable seat_uuid (the only key used by orders), label, local (x,y), accessibility none|wheelchair|companion|aisle|limited_mobility, restricted_view, price_category_override, tags
- Object entity: stage|booth|entrance|exit|dance_floor|bar|buffet|restroom|pillar|label|image|custom polygon, transform, is_obstacle, is_focal_point (drives best-available and VIP-near-stage scoring)
- Coordinates: world units in centimetres, integer, origin top-left, y down, rotation degrees; layout.scale_px_per_cm for display
- event_seats (event_id, seat_uuid, section_id, price_category, status available|held|reserved|sold|blocked|comp|resale, hold_token, order_item_id, quality_score, accessibility, channel_key) with unique(event_id, seat_uuid) — normalised inventory separate from JSONB geometry
- price_categories (layout-level key, name, colour) × ticket_types (event-level) = price matrix; optional per-seat override; fee-inclusive flag
- channels (event_id, key, name) and seat→channel assignment for box office / presale / sponsor allotments
- Redis: hold:{eventId}:{seatUuid} string with TTL and cart token; holds:{eventId} ZSET scored by expiry; pub/sub channel per event for SSE deltas with a monotonically increasing version
- guests (tenant CRM person link, name, party_id/guest_group_id, tags vip|association|meal|accessibility_needs, rsvp_status) and guest_groups (size drives solver)
- assignments (event_id, guest_id, table_id, seat_uuid nullable, source manual|auto|import, revision) — feeds unseated-count alerts in the Command Center
- seating_rules (event_id, type keep_together|keep_apart|must_sit_at|cannot_sit_at|near_object|far_from_object, subject refs, weight hard|soft:int) consumed by both tabu and CP-SAT solvers
- selection_validators / rulesets per event (noOrphanSeats strict|lenient, seats_between_groups, rows_between_groups, max_group_size, max_occupancy_pct, one_group_per_table) and an ADA rule config with audit log
- seat_finder_config per event (public key, signed QR, passcode, show_tablemates, kiosk PIN, TV mode settings) and a cached guest snapshot with ETag
- Capacity is derived, not stored: Σ sellable reserved seats + Σ GA capacities; compare against event.capacity and tickets issued for alerts


## Risks

- Per-seat Konva nodes will not scale to 20k seats; if the team skips the batched custom-shape/LOD approach the editor will hit Mobile Safari's 256–384 MB canvas ceiling and go blank on iPad.
- react-konva major version is pinned to the React major (19.x today); every React major upgrade forces a react-konva upgrade and retest of the editor.
- Redis holds are eventually consistent: keyspace expiry events are not guaranteed under load and TTL precision is coarse; without the reconciler job and Postgres-side confirmation, double-booking or stuck 'held' seats will occur during on-sales.
- Locking an event layout after first sale is essential; allowing destructive edits (deleting/renumbering seats) after tickets are sold will orphan orders and break QR check-in mapping.
- ADA hold-and-release and companion-seat rules are legal obligations for US venues; treating them as optional UI conveniences exposes organizers (and Yayatoh as platform) to complaints — the exact Table 221.2.1.1 counts quoted here are UNVERIFIED and must be checked against the 2010 Standards before being surfaced to users.
- A canvas-only buyer UI fails WCAG 2.2 keyboard/screen-reader criteria; the accessible list mode must be built in phase 1, not retrofitted.
- Auto-seating is NP-hard; the tabu heuristic gives good-not-optimal results and can report infeasible when a solution exists — the UI must present results as proposals and never silently overwrite manual assignments.
- OR-Tools CP-SAT introduces a Python service into a Next.js/TypeScript stack (deployment, scaling, and a second language); or-tools-wasm (0.9.1) could remove it later but needs COOP/COEP headers that may conflict with third-party embeds (Stripe, analytics).
- Migrating existing Laravel seating data (unknown schema, coordinate system and seat identities) may not map cleanly onto stable seat_uuids; a lossy import breaks historical orders and reports.
- PDF/SVG export paths are an XSS surface (see Fabric.js CVE-2026-27013/44311); sanitize labels and object text before serializing to SVG/PDF.
- Multi-tenant white-label seat finder and kiosk pages are public, unauthenticated surfaces; guest names are PII — passcodes, rate limiting, and per-tenant data isolation must be enforced at the API, not just the UI.
- WebGPU/PixiJS is not a safe default in 2026 (Firefox disabled, Safari partial); any decision to adopt PixiJS for a stadium customer must keep the WebGL/Canvas fallback tested.


## Open questions

- What is the largest seat count and table count Yayatoh has actually sold or seated to date, and what is the realistic 3-year ceiling (theater 2,000 / arena 15,000 / stadium 50,000)? This decides whether Konva alone is sufficient forever.
- How are seats identified in the current Laravel database (numeric ids, section/row/seat strings, coordinates in pixels?) and must historical orders remain linked to seats after migration?
- Is on-site tablet editing (moving tables the morning of an event) a real requirement for Yayatoh's customers, or is desktop-only editing acceptable for phase 1?
- Do any current customers require box-office allotments, presale channels, or sponsor-held tables that must be modeled as channels from day one?
- Are Yayatoh's ticketed venues subject to US ADA ticket-sales rules (most are), and should Yayatoh enforce hold-and-release automatically or only warn organizers?
- For weddings/galas, is 'assign to table' sufficient or do customers need seat-level assignment (place cards) at launch?
- How important is auto-seating at launch versus later — should the Tier-1 tabu solver ship in phase 2 or be deferred to phase 3?
- Is a Python microservice acceptable operationally, or must all backend code stay in TypeScript (which would push Tier-2 to or-tools-wasm or drop it)?
- Which printed outputs do customers actually use today (place cards, escort cards, table cards, seating chart poster, signage) and in which paper sizes/label templates?
- Should the seat finder support venue floor-plan image underlays uploaded by planners (as Venued/SeatFound do) in phase 1, or only Yayatoh-drawn layouts?
- Is multi-user simultaneous editing of a floor plan (planner + venue + client) a requirement, or is single-editor with autosave and revision history enough?
- Do the existing mobile apps render seat maps today, and if so from what data format — do they need the layout JSON or a pre-rendered image via the API?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
- https://www.seats.io/pricing
- https://www.seats.io/features
- https://docs.seats.io/docs/api/best-available/
- https://docs.seats.io/docs/api/hold-tokens/
- https://docs.seats.io/docs/renderer/config-selectionvalidators/
- https://docs.seats.io/docs/renderer/config-pricing/
- https://support.seats.io/en/articles/2074512-multilevel-pricing
- https://github.com/konvajs/konva/blob/master/CHANGELOG.md
- https://registry.npmjs.org/konva/latest
- https://registry.npmjs.org/react-konva/latest
- https://konvajs.org/docs/react/index.html
- https://konvajs.org/docs/performance/All_Performance_Tips.html
- https://konvajs.org/docs/sandbox/20000_Nodes.html
- https://konvajs.org/docs/sandbox/Drag_and_Drop_Stress_Test.html
- https://konvajs.org/docs/sandbox/Multi-touch_Scale_Stage.html
- https://konvajs.org/docs/select_and_transform/Rotation_Snaps.html
- https://konvajs.org/docs/sandbox/Objects_Snapping.html
- https://bundlephobia.com/api/size?package=konva@10.7.0
- https://bundlephobia.com/api/size?package=fabric@7.4.0
- https://bundlephobia.com/api/size?package=pixi.js@8.21.0
- https://github.com/pixijs/pixijs/releases
- https://registry.npmjs.org/pixi.js/latest
- https://registry.npmjs.org/@pixi/react/latest
- https://github.com/pixijs/pixi-react/releases
- https://pixijs.com/blog/pixi-react-v8-live
- https://github.com/fabricjs/fabric.js/blob/master/CHANGELOG.md
- https://registry.npmjs.org/fabric/latest
- https://tldraw.dev/pricing
- https://tldraw.dev/community/license
- https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md
- https://registry.npmjs.org/tldraw/latest
- https://registry.npmjs.org/d3-zoom/latest
- https://caniuse.com/webgpu
- https://seatmap.pro/blog/seating-plan-rendering/
- https://seatmap.pro/features/
- https://github.com/alisaitteke/seatmap-canvas
- https://designawards.core77.com/Interaction/49734/Eventbrite-Reserved-Seating-System
- https://www.eventbrite.com/help/en-us/articles/683914/how-to-set-up-a-reserved-seating-event/
- https://help.ticketmaster.com/hc/en-us/articles/9786899270545-What-is-the-interactive-seat-map-and-how-do-I-use-it
- https://business.ticketmaster.com/interactive-seat-maps/
- https://www.cvent.com/en/event-marketing-management/cvent-event-design-software
- https://meetings.skift.com/2025/04/24/cvent-resumes-acquisition-spree-buying-spatial-tech-company-prismm/
- https://www.planseats.com/compare/prismm-vs-planseats
- https://seatfound.com/
- https://www.venued.app/pricing
- https://seatplan.io/learn/seat-finder
- https://seatyourself.io/
- https://www.ada.gov/resources/ticket-sales/
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster
- https://oneuptime.com/blog/post/2026-03-31-redis-how-to-model-bookingreservation-systems-in-redis/view
- https://rhydlewis.eu/papers/LewisCarroll.pdf (Lewis & Carroll, Creating Seating Plans: A Practical Application, 2016)
- https://github.com/google/or-tools/releases
- https://pypi.org/project/ortools/
- https://github.com/Axelwickm/or-tools-wasm
- https://registry.npmjs.org/or-tools-wasm/latest
- https://www.npmjs.com/package/z3-solver
- https://registry.npmjs.org/yalps/latest
- https://registry.npmjs.org/fuse.js/latest
- https://registry.npmjs.org/@use-gesture/react/latest
- https://registry.npmjs.org/@react-pdf/renderer/latest
- https://medium.com/@codetip.top/svg-vs-canvas-vs-webgl-for-diagram-viewers-tradeoffs-bottlenecks-and-how-to-measure-8cedbd3b7499
- https://pauljadam.com/demos/canvas.html
- https://accessibility.build/guides/accessible-maps
