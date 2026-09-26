# Wedding Social

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Wedding, gala and social-event experience (guest list, RSVP, invitations, seating, seat finder, guest site, check-in, day-of tools) modeled on SeatFound, Venued, Zola, The Knot, RSVPify, Joy, AllSeated/Prismm, Social Tables (Cvent), PerfectTablePlan, TopTablePlanner

# Yayatoh 2.0 — Wedding, Gala & Social-Event Experience: Competitive Research

Grounded in the vision document (sections 6 "Improve Weddings, Galas and Social Events", 10 "Improve Seating", 12 "Different Event Types Without Making the System Complicated"). Research date: 2026-09-26. Primary sources fetched where possible; several vendor pages (rsvpify.com, theknot.com, help.rsvpify.com) return HTTP 403 to fetchers, so those findings rely on search-engine summaries and third-party pricing aggregators and are marked accordingly.

## 1. Competitor snapshot

| Product | Positioning | Pricing (verified unless noted) | What it does best |
|---|---|---|---|
| **SeatFound** (seatfound.com) | QR/kiosk seat-and-booth finder for galas, conferences, weddings | $49 flat per event (unlimited attendees/booths; homepage says event stays active ~2 days post-event); Agency $99/mo unlimited events + white-label; first event free, no card | Kiosk/TV display modes, offline-after-load, Google Sheets live sync, one-click layout generators |
| **Venued** (venued.app, Scotland) | Free-to-start QR seating chart for weddings/parties | Free: 1 event, 100 guests, ads. Pro $19/mo: 2 events, 1,000 guests, gallery, floor-plan upload, no ads. Organizer $60/mo (list $109): unlimited, dedicated support | Permanent QR that never changes, paste-from-spreadsheet import, guest photo gallery, post-event scan/table-popularity insights |
| **Zola** | Free wedding website + guest list + RSVP; seating chart in iOS app | Guest list/RSVP free; seating chart free to 15 guests then Premium unlock (price UNVERIFIED); iOS-app only | Household model, multi-event RSVP, meal/children breakdowns, free envelope addressing, Contact Collector link |
| **The Knot** | Free (ad-supported) guest list synced to website | Free | RSVP tracking with meal/dietary/special-requirements fields; guest messaging reminders. Visual seating tool: conflicting reports (see §5) |
| **RSVPify** | RSVP/registration for personal + business events | Personal free to 500 guests; Business Starter $39/mo (150 reg/mo, seating chart, custom Qs); Plus $125/mo (500 reg/mo, QR check-in, capacity, exclusive invite lists, +1 rules); Professional $409/mo (1,500 reg/mo, form logic, custom CSS); Enterprise custom (white-label, SSO). Ticketed: 1.95% + $0.90/ticket, Professional included (Capterra 2026) | Secondary events with per-event invite lists, capacity, conditional visibility; unique RSVP links; check-in by QR/name/code/email; kiosk + badge print |
| **Joy** (withjoy.com) | Free website, guest list, RSVP, digital invites | Free core; paid: premium designs, custom domain, printed cards from $1.51, "Messaging Plus" one-time SMS unlock (US/CA only; price UNVERIFIED) | Parties with one-person RSVP, unnamed plus-ones filled by guest, tag-driven conditional questions and event visibility, guest app, gallery with live slideshow, 8 languages |
| **Prismm** (ex-AllSeated) | 2D/3D floor plans, virtual walkthroughs, guest list for planners/venues | Acquired by Cvent 2025-04-24. Being sunset: Cvent's page says new-event cutoff 2026-08-26, editing ends June 2027; third parties cite view-only 2026-10-01 and shutdown 2026-12-31 (conflicting — UNVERIFIED which is current) | 50,000 venue floor plans, 6,000 3D spaces, real-time collaboration. Its exit creates a planner/venue gap |
| **Social Tables / Cvent Event Diagramming** | Enterprise diagramming + attendee management + check-in | Free (1 user, 3 events, 150 attendees); Standard $49/mo; Pro $150/mo; Premium $320/mo (unlimited, custom fields, check-in); Enterprise (3D, Cvent Registration sync). 12-month commitment on paid. (One aggregator lists $199/mo — inconsistent; socialtables.com/pricing is authoritative) | To-scale CAD/PDF diagrams, 6,700+ venue library, bulk seat/check-in edits, dedupe+merge, unlimited check-in devices, table/seat printed on badges via Registration↔Diagramming two-way sync (GA 2025-06-04) |
| **PerfectTablePlan** | Desktop (Win/Mac, offline) seating optimizer | One-time: Home $29.95, Advanced $74.95, Professional $299.95; 5 installs. v7 released 2024-05-06; latest 7.2.1 (2025-12-08, per search snippet — UNVERIFIED) | Genetic-algorithm auto-seating with proximity scoring; E-shaped/serpentine tables; place/escort cards; VDU chart; barcode check-in (Pro) |
| **TopTablePlanner** | Browser table planner | One-time ~$20 for 6 or 12 months; Personal 5 saved plans, Professional 20 (12 mo) | Simplicity: round/square/rectangular tables, named tables, Word/Excel import, PDF/meal summaries, A4–A1 poster export, multi-login for partner/venue |

Useful adjacent tools: SeatPlan.io (seat finder with optional passcode, "show tablemates", read-only chart), FindYourSeat.co.uk (free 20 guests; £19.99 one-time; "Tablet Mode" staff check-in; live check-in dashboard), Lovely Seating ($29 one-time; hard/soft rules: must-sit-together, prefer-together, keep-apart; auto-seat with rebalancing), Please Find Your Seat (free ≤50 guests), FindMyTable ($75 flat).

## 2. Findings by capability

### 2.1 Guest list management
- **Households/parties are the unit of invitation.** Zola: "assign guests to a household and send them one invitation"; Joy: parties where "one person can respond for the entire group"; The Knot: "sending one invitation to multiple guests". Every serious tool separates the *party* (envelope, address, primary contact) from the *guest* (person).
- **Plus-ones are placeholder guests.** Joy lets hosts add a plus-one with a blank name; the guest fills it at RSVP and "the name(s) will magically appear on your guest list". Joy optionally lets guests "Add Another Guest / Remove a Guest" within their party. Zola: "only authorized guests can RSVP, eliminating unwanted plus-ones". RSVPify sells "+1 offerings" as a Plus-tier feature.
- **Children** are tracked as a guest type. Zola has a "total breakdown of adults and children invited or attending" report; TopTablePlanner categorises male/female/children/VIP.
- **Groups/tags.** Joy tags drive "targeted messaging, specific RSVP questions, and event access control"; Zola pre-groups by relationship (family, coworkers, college friends) plus "Definitely/Maybe" list status and bride/groom side; Social Tables uses colour-sorted tags plus group objects that auto-filter tables lacking enough seats for the group.
- **Dietary/meal/accessibility.** Meal choice per guest is universal; The Knot additionally stores "dietary restrictions, and special requirements". No wedding tool models accessibility needs explicitly — an opportunity (wheelchair access, near-exit, hearing loop, quiet area).
- **Import/dedupe.** Paste-from-spreadsheet (Venued), CSV/XLSX/Google Sheets live sync (SeatFound), Word/Excel (TopTablePlanner), duplicate detection with merge (Joy, Social Tables, PerfectTablePlan 7 import). Zola's "Contact Collector" and Joy's equivalent give hosts a public link guests use to submit their own addresses.
- **Address/stationery.** Zola formats and prints envelope addresses free and tracks "which guests have received your Save the Dates or Invitations".

### 2.2 RSVP flows
- **Identification methods** in the market: (a) name lookup on the site (Zola, Joy, The Knot) with optional "strict name matching" (Joy) / invite-only; (b) unique per-party RSVP links (RSVPify "unique RSVP links, guest list validation"); (c) event passcode (SeatPlan.io "type their name (and passcode, if set)"; SeatFound "PIN protection"). Best practice for Yayatoh: support all three — party magic link/QR as the primary path, name lookup as fallback, optional event PIN.
- **Household RSVP:** one responder answers attendance + meal + questions for each member of the party (Joy, Zola). Joy addresses the whole party on the e-card while needing only one email.
- **Multiple sub-events:** Zola "Collect RSVP to multiple events"; Joy uses "conditional logic that only shows specific events to tagged guests" (e.g., rehearsal dinner visible only to wedding-party tag); RSVPify secondary events each carry their own invite list, "attendance limits, time slots, or capacity rules", optional payment, and can be shown conditionally on the primary response or restricted to a tag. Each RSVPify sub-event also has independent check-in and its own seating chart.
- **Questions:** Joy — attendance, multiple choice, short answer; dependent questions (dietary, hotel, mailing address) triggered by an "attending" answer; "private questions" for subsets; disabling preserves answers. RSVPify Professional adds form logic.
- **Deadlines/reminders:** Joy toggles RSVP on/off and schedules reminders; Zola offers "free RSVP message reminders"; The Knot only email-style guest messages ("doesn't send text messages… or automate follow-ups" per third-party review). Joy's SMS is a one-time paid unlock, US/CA numbers only.
- **Paper fallback:** Joy and Zola both allow manual entry of mailed reply cards; source of response should be recorded.

### 2.3 Invitations
- Joy: unlimited free digital e-cards with built-in RSVP sent "via email, shareable link, or text"; printed cards from $1.51 with QR or link on the back; response tracking per guest with email history in the profile. RSVPify: email invitations plus ICS calendar invites and save-the-dates at Starter tier. QR on printed invitations is now expected (Zola's comparison notes all platforms "support QR codes and URLs on invitations").

### 2.4 Seating
- **Canvas objects:** tables (round, rectangular, square; PerfectTablePlan adds E-shaped and serpentine; Zola adds custom shapes), head table, dance floor, bar, cake/gift tables, doors, AV (Zola); stages, registration desks, lounges, pillars, booths (SeatFound); to-scale rooms from CAD/PDF (Cvent). TopTablePlanner is explicitly "not to scale" — fine for weddings, not for venues.
- **Assignment granularity:** table-level by default, seat-level on demand (Zola "drag and drop them around the table"; Venued "table or seat number"; PerfectTablePlan and Cvent full seat-level). Sections/VIP areas are a ticketing-world concept Yayatoh already has; wedding tools express VIP as a flag/table label, and galas as "Table Sponsored by" (SeatFound guest screen).
- **Guest sync:** Zola pulls confirmed guests automatically; a late plus-one "appears immediately as an unseated attendee", a meal change "displays directly in their seating profile". Social Tables exposes the unseated list beside the diagram and bulk actions (group, seat, check-in). This "unseated" queue is the core UX primitive.
- **Layout generators:** SeatFound "one-click seating generators for theater, classroom, U-shape, chevron, and banquet"; Cvent's CventIQ automates diagram creation and table numbering.
- **Auto-seat and conflict rules:** PerfectTablePlan is the reference: five proximities — next to (+20), near (+5), near-not-next-to (−5), not next to (−10), not near (−40) — VIP scores ×3, unassigned guest −100, different-group adjacency −30, solved by a genetic algorithm with seat/table locks and a user time limit (≤3600 s). Lovely Seating's simpler model (must-sit-together hard, prefer-together soft, keep-apart hard, auto-seat "honouring who sits together and who stays apart" with re-balancing on RSVP change) is closer to what a couple will actually use. Social Tables' pragmatic rule: hide tables that cannot fit the whole group.
- **Outputs:** PDF/Excel exports, place cards and escort cards (Zola, PerfectTablePlan, TopTablePlanner A4–A1), sharing with venue/planner (Zola PDF; TopTablePlanner multi-login), badge printing of table/seat (Cvent).
- **Collaboration:** Prismm/Cvent real-time multi-user editing with roles and comments; TopTablePlanner shared login for partner/venue/parents.

### 2.5 Seat finder, kiosk and display modes
- **Baseline pattern (all QR tools):** one permanent QR/URL per event → guest types name → sees table (and seat) instantly, "no app download, no login". Venued stresses that the QR "never changes" even as assignments change; SeatPlan.io that the sign "is never out of date".
- **Enhancements:** highlight table on the floor map (SeatFound "highlighted on the live floor map"; Venued floor-plan upload on paid tiers); optional "show tablemates after lookup" and read-only full chart (SeatPlan.io); menu/program/welcome video on the result screen (Venued); session selector and networking "View your connections" (SeatFound guest UI); company→booth lookup for expos (SeatFound).
- **Kiosk/TV:** SeatFound offers kiosk mode for tablets with screensaver, a "branded TV display sign for your venue lobby" with QR, and offline-after-load so "venue WiFi can't break it". FindYourSeat has a "Tablet Mode" for staff-assisted lookup. PerfectTablePlan renders a VDU chart for projectors. None of the wedding tools offer an auto-scrolling alphabetical TV board — cheap differentiator.
- **Privacy:** PIN/passcode gating (SeatFound, SeatPlan.io); Joy password per site or page.
- **Analytics:** Venued "total scans and table popularity"; SeatFound "check-in tracking and analytics, attendance reporting".

### 2.6 Guest-facing event site
Joy is the benchmark: schedule with per-guest visibility, travel/hotel blocks/shuttles with maps and Uber/Lyft deep links, aggregated registry links, FAQ, wedding party bios, story, password protection (site or page), custom domain (paid), tag-based content visibility, companion mobile app, guest photo uploads with a "real-time slideshow during reception", and 8 UI languages. Venued adds a lighter version (menu, program, info, gallery) attached to the seat-finder page. Given Yayatoh already ships 12 UI languages, guest-site localisation should be table stakes.

### 2.7 Guest check-in and day-of tools
- Wedding/gala check-in is *guest-based* (name/party) rather than ticket-based. FindYourSeat records "check-in tracked live and visible to admins"; RSVPify checks in by "QR code or searching by guest name, confirmation code or email address", supports self check-in kiosks and badge printing, and per-sub-event check-in; Social Tables allows "unlimited devices", sorting by name/email/org, filtering by check-in status, and showing up to three labels (e.g., table, meal, VIP) beside each name; Cvent OnArrival staff "reference the seating arrangements" and "manage VIP routing and table changes".
- Day-of host dashboard elements seen across tools: arrivals vs expected, unseated guests, no-shows by table, meal counts by table for catering, scan/lookup counts, live gallery/slideshow, and a "walk-up" add-guest action. PerfectTablePlan 7 ships a dashboard of 8 charts (assignments, RSVP status, gender, age) — useful as a pre-event readiness view.

## 3. What SeatFound and Venued do well (and their pricing lesson)
- **SeatFound** wins on *venue-grade reliability*: offline-capable kiosk, lobby TV sign, live spreadsheet sync so a planner never re-imports, one-click layouts for five room styles, expo/booth lookup, table sponsor labels, session switcher, PIN gating, and an Agency plan with white-label. Its flat $49/event with unlimited guests is a pricing model planners understand; its $99/mo Agency tier is the prototype for Yayatoh's "planner/agency" white-label tier.
- **Venued** wins on *zero-friction onboarding*: paste a list, get a permanent QR, print a free poster (Canva templates included), upgrade only when you need a floor plan, gallery, or >100 guests. Its Free→$19→$60 ladder is the prototype for Yayatoh's wedding self-serve pricing; the ad-supported free tier is the acquisition engine.
- Neither has RSVP, invitations or a real floor-plan editor; both are point tools. Yayatoh's advantage is the connected chain guest list → RSVP → seating → seat finder → check-in → analytics that today requires Zola/Joy + a seating tool + a QR finder.

## 4. Prioritized feature list

**P0 — must ship with the wedding/gala module (parity with Zola/Joy + Venued/SeatFound)**
1. Party/household model with primary contact, envelope name, address; guests with type (adult/child/infant), side, relationship group, VIP flag, meal choice, dietary restrictions, accessibility notes, free-text notes.
2. Placeholder plus-ones (named or unnamed) with host-controlled allowance; guest-editable party size (toggle).
3. Import: paste, CSV/XLSX, Google Sheets; column mapping; duplicate detection + merge; export CSV/XLSX/PDF.
4. Sub-events (ceremony, reception, rehearsal, brunch) with per-party invitation matrix, per-sub-event RSVP, meal and capacity.
5. RSVP page: party magic link + QR, name lookup with strict-match option, event PIN option; household RSVP in one flow; question builder with attendance-dependent and tag-conditional questions; deadline; manual/paper entry with source recorded; response audit history.
6. Reminders: scheduled email to non-responders (SMS/WhatsApp via the platform notification module, treated as a paid add-on like Joy).
7. Visual seating: canvas with round/rect/square tables, seat count, numbering/naming, rotation, head table, dance floor, stage, bar, cake/gift tables, entrances, custom labelled shapes; drag-and-drop; table-level assignment with optional seat-level; unseated queue that auto-updates on RSVP/plus-one changes; "table can't fit this party" warning; undo/versions; PDF/Excel export; place/escort cards; venue share link.
8. Seat finder: permanent per-event QR/URL; name search; result shows table/seat, highlighted on map, tablemates (toggle), menu/program; optional PIN; print-ready QR poster; "not yet active / ended" states.
9. Kiosk mode (tablet, screensaver, offline snapshot after load) and TV board mode (branded, QR, auto-scrolling A–Z table list).
10. Guest check-in by name/party/QR with multi-device sync, no-double-check-in, walk-up add; day-of host view: arrivals, unseated, meal counts by table.
11. Guest event site: schedule, travel/accommodation, registry links, FAQ, gallery, password; inherits white-label branding and custom domain from the tenant; all 12 UI languages.
12. Wedding "mode" that hides all ticketing/enterprise modules (see §7).

**P1 — differentiate within 6–9 months**
13. Seating rules and auto-seat: must-sit-together (party default), keep-together (group), keep-apart, near-not-next-to; VIP-near-stage; one-click fill and re-balance; lock seats/tables. Start with a constraint-satisfaction/greedy + local-search solver; expose PerfectTablePlan-style weights only in an "advanced" drawer.
14. One-click layout generators (banquet rounds by guest count, theater, classroom, U-shape, chevron) from room dimensions.
15. Gala hybrid: sponsored/hosted tables where a table host (sponsor) receives a link to name their seats; sponsor label on seat-finder result; optional paid tables/tickets and donations reusing the existing ticketing module.
16. Digital invitations and save-the-dates (email/SMS/link) with open/click tracking and QR for print; contact-collector link.
17. Guest photo/video gallery with moderation and live slideshow mode.
18. Planner/agency workspace: multiple client events, clone event, template floor plans, client (couple) collaborator role, white-label seat finder ("Powered by" removable) — the SeatFound Agency / Prismm-refugee segment.
19. Seat-finder and RSVP analytics: lookups, scans, response funnel, table popularity.

**P2 — later**
20. To-scale floor plans from PDF/CAD, venue library per tenant, 3D preview.
21. Registry/hotel-block integrations, Uber/Lyft deep links, calendar (ICS) invites.
22. Networking "your connections at this table" for corporate galas; expo booth lookup (shares canvas with the exhibitor module).
23. Real-time multi-user seating collaboration with comments.
24. Table/seat printed on badges via the enterprise badge module.

## 5. UX patterns to copy (and one to avoid)
- Venued: "paste your list" first-run; QR that never changes; free poster + Canva templates; upgrade prompts only at 100 guests/floor-plan/gallery.
- Joy: blank plus-one the guest names; tag → conditional question/event visibility; disable-not-delete questions; email history on the guest profile; per-page password.
- Zola: unseated queue reacting to plus-ones and meal changes; adults/children and meal totals; "Definitely/Maybe" lists; envelope addressing from the same data.
- SeatFound: event lifecycle states on the public page; kiosk screensaver; lobby TV with QR; session picker; "Table Sponsored by"; offline-after-load.
- Social Tables: bulk actions (group/seat/check-in) from the list; hide tables that can't fit the group; up to three labels next to names at check-in.
- PerfectTablePlan: named proximity types and locks; but hide its scoring UI behind an advanced panel.
- Avoid: Zola's iOS-only seating chart (couples plan on laptops with venues); The Knot's tracking-only guest list with no follow-up automation; 12-month lock-ins (Cvent) for a self-serve wedding tier. Note the conflicting reports on whether The Knot currently offers a visual seating tool (third-party 2025–2026 articles say no, one says drag-and-drop exists; The Knot's own help article was unreachable) — UNVERIFIED; do not benchmark against it.

## 6. Data-model implications
See the structured list; headline: separate **Party → Guest** (invitation-side) from **Order → Ticket → Attendee** (commerce-side) with an optional Guest↔Ticket link so a gala can be both; sub-event invitation matrix; RSVP access tokens; canvas/object/seat/assignment tables shared with reserved-seat ticketing; a rules table for seating constraints; public seat-finder settings + lookup analytics; guest-level check-in records; event-type profile controlling modules and vocabulary.

## 7. How the wedding experience must be simplified
A wedding organizer's navigation is exactly: **Guests | RSVP | Seating | Seat Finder | Website | Messages | Day-of** (plus Settings). Vocabulary switches to Guests/RSVP/Party (never Attendees/Registration/Order). Defaults: one sub-event pre-created ("Reception"), table-level seating, name-lookup RSVP with strict match on, seat finder auto-enabled once one table is assigned.

They should **never see**: ticket types, pricing, promo codes, orders, refunds, payouts, fraud/duplicate-scan dashboards, scanner-fleet/device management, sessions, tracks, speakers, exhibitors, sponsors, lead retrieval, badge designer, audience segment builder (replaced by tag filters in "Messages"), marketing attribution, API keys/webhooks, custom-domain/white-label settings (planner/agency level only), and roles beyond Co-host, Planner, Venue (read-only). Galas unlock a single extra tab ("Tables & Sponsors" or "Tickets") from the same wedding profile rather than the conference profile. The enterprise seating engine, check-in engine and notification engine are the same code underneath; only the event-type profile, defaults and terminology change.


## Key recommendations

- Model invitations as Party → Guest (households, placeholder plus-ones, children, side, group tags, dietary/accessibility) separate from Order → Ticket → Attendee, with an optional Guest↔Ticket link so galas can be both RSVP'd and ticketed.
- Ship sub-events (ceremony/reception/rehearsal/brunch) with a per-party invitation matrix, per-sub-event RSVP, meal and capacity, and tag-conditional visibility — this is what RSVPify and Joy do and Zola/The Knot only partially do.
- Support three RSVP identification paths from day one: per-party magic link/QR (primary), name lookup with strict-match toggle (Zola/Joy pattern), and optional event PIN (SeatFound/SeatPlan pattern); record response source (online/paper/manual) and keep an audit history.
- Build the seating canvas once (tables, seats, sections, stage, dance floor, entrances, booths, custom objects) and reuse it for reserved-seat ticketing, weddings and expos; make the 'unseated queue' that reacts to RSVP/plus-one/meal changes the central UI primitive (Zola/Social Tables).
- Copy Venued's permanent QR + name-search seat finder and SeatFound's kiosk (screensaver, offline-after-load) and branded TV board with QR; add an auto-scrolling A–Z table board that no wedding competitor offers.
- Implement seating rules as simple hard/soft constraints (must-sit-together = party default, keep-together, keep-apart, near-not-next-to, VIP-near-stage) with one-click auto-fill and rebalance; hide PerfectTablePlan-style numeric weights behind an advanced drawer.
- Treat guest check-in as name/party based (not ticket based) with multi-device sync, up to three labels beside each name (table, meal, VIP), walk-up add, and a day-of host view (arrivals, unseated, meal counts by table).
- Give the wedding profile exactly seven tabs — Guests, RSVP, Seating, Seat Finder, Website, Messages, Day-of — with wedding vocabulary, and hide all commerce, enterprise and platform settings; galas add a single 'Tables & Sponsors' tab reusing the ticketing module.
- Price the self-serve wedding tier like Venued (free with guest cap → ~$19–29/event or month) and add a planner/agency white-label tier like SeatFound's $99/mo to capture Prismm/AllSeated refugees before the 2026–2027 sunset.
- Make SMS/WhatsApp reminders a metered add-on (Joy's Messaging Plus pattern) on top of free email reminders, routed through the platform notification module rather than a wedding-specific implementation.
- Localise the guest-facing RSVP page, seat finder and event site in all 12 existing Yayatoh languages; Joy ships 8 and none of the seating tools ship any.
- Provide a guest photo/video gallery with moderation and a live slideshow mode on the seat-finder/TV surfaces (Venued and Joy both offer this and it drives guest engagement at low cost).


## Data model implications

- Party (household): id, event_id, display_name/envelope_name, primary_guest_id, mailing address, email/phone, language, access_token (magic link/QR), invitation_status, tags.
- Guest: id, party_id, first/last name (nullable for placeholder plus-ones), guest_type (adult/child/infant), is_placeholder, added_by_guest (bool), side (bride/groom/custom), relationship_group, vip (bool), dietary_restrictions[], accessibility_needs, notes, org_contact_id (link to tenant-level CRM person), ticket_id (optional link to commerce attendee).
- PlusOneAllowance on Party: allowed_count, named_required, guest_can_edit_party_size.
- Tag (tenant-scoped, event-applied) many-to-many with Guest and Party; drives conditional questions, sub-event visibility and message audiences.
- SubEvent: id, event_id, name, type, starts_at, venue/room, capacity, rsvp_enabled, meal_options[], visibility_rule (all / tag / conditional-on-primary).
- GuestSubEventInvitation: guest_id, sub_event_id, invited (bool), rsvp_status (pending/attending/declined/maybe), responded_at, response_source (online/paper/manual/import), meal_choice, seat_assignment_id.
- RsvpQuestion: event_id or sub_event_id, type (attendance/multiple choice/short answer), required, visibility (all/tag/dependent on attending), order, is_active (disable not delete); RsvpAnswer: guest_id, question_id, value.
- RsvpSettings per event: identification_mode (link/name/pin), strict_name_match, deadline_at, reminders_schedule[], allow_guest_edit_after_submit; RsvpResponseHistory (audit).
- Invitation/Message: id, event_id, channel (email/sms/whatsapp/print), template, audience (tag filter), scheduled_at, per-recipient delivery/open/click status; ContactCollectorLink token.
- FloorPlan: id, event_id, sub_event_id (nullable), room dimensions/scale, background_image, version/snapshot; CanvasObject: floor_plan_id, kind (table/stage/dance_floor/bar/entrance/booth/section/custom), shape, x,y,rotation,w,h, label, capacity, table_number, sponsor_label, section_id, is_vip, locked.
- Seat: canvas_object_id, seat_index/label, locked; SeatAssignment: guest_id (or party_id), canvas_object_id, seat_id (nullable = table-level), assigned_by, assigned_at.
- SeatingRule: event_id, type (must_together/prefer_together/keep_apart/near_not_next_to/vip_near_object), subject_type (guest/party/group/tag), subject_ids[], weight, hard (bool); AutoSeatJob: status, score, log.
- SeatFinderSettings: event_id, public_slug/QR (immutable), state (draft/active/ended), pin (nullable), show_tablemates, show_map, show_menu/program, kiosk_enabled, tv_board_enabled, branding overrides; SeatLookupEvent: event_id, guest_id (nullable), device_kind (phone/kiosk/tv), timestamp, matched (bool).
- KioskDevice: event_id, device_token, mode (kiosk/tv/staff-tablet), last_snapshot_version, last_seen_at (feeds 'devices offline' alerts and offline snapshot delivery).
- GuestCheckIn: guest_id, sub_event_id, entrance_id, device_id, method (qr/name/kiosk/manual), checked_in_at, duplicate_attempt (bool), undone_at.
- GuestSite: event_id, pages[] (schedule/travel/registry/faq/party/story/gallery), per-page visibility (tag/sub-event), password, custom_domain (inherits tenant white-label), locales[]; RegistryLink; TravelInfo (hotel block, shuttle).
- MediaUpload (gallery): event_id, guest_id (nullable), url, moderation_status, slideshow_eligible.
- EventTypeProfile: key (wedding/gala/concert/conference/agency), enabled_modules[], nav_tabs[], vocabulary map (Guest vs Attendee, RSVP vs Registration), default settings; assigned per event and overridable per tenant.
- Gala extension: HostedTable (canvas_object_id, sponsor org/contact, host_access_token, seats_purchased) linking to Order/Ticket in the commerce module; Donation optional.


## Risks

- Scope creep: the seating canvas serves weddings, reserved-seat ticketing and expos; if built three times or over-engineered for 3D/to-scale first, the wedding MVP slips. Mitigate by shipping not-to-scale 2D first (TopTablePlanner/Zola level) with a scale-aware data model.
- Auto-seating quality: PerfectTablePlan-grade optimisation is CPU-heavy (its docs warn time 'goes up rapidly with the number of guests'); run it as a background job with a time cap and show a 'good enough' greedy result instantly.
- Offline kiosk/TV correctness: SeatFound's 'works offline once loaded' implies snapshot versioning; stale snapshots after last-minute swaps will seat guests wrongly unless devices poll/subscribe and show snapshot age.
- Privacy: public name lookup can leak guest lists (enumeration). Require minimum characters, rate-limit, offer PIN, never show full lists on phone lookups (TV board opt-in only), and comply with the tenant's data-isolation rules.
- SMS/WhatsApp deliverability and cost: Joy limits SMS to US/CA; A2P 10DLC registration and WhatsApp template approval take weeks and must be handled at the platform (tenant) level, not per wedding.
- Vocabulary/nav complexity: if the wedding profile is implemented as hidden enterprise screens rather than a distinct nav/vocabulary layer, leakage of terms like 'attendee', 'order', 'session' will undermine the 'simple for couples' goal.
- Several vendor pages (rsvpify.com, theknot.com, help.rsvpify.com, help.socialtables.com) could not be fetched; RSVPify tiers come from Capterra (2026) and The Knot seating-tool status is contradictory across sources — re-verify before quoting in sales material.
- Prismm/Cvent sunset dates conflict between Cvent's community page (editing through June 2027) and third-party migration pages (view-only Oct 1 2026, shutdown Dec 31 2026); the planner/venue opportunity is real but timing is uncertain.
- Zola's seating chart being iOS-only and freemium (15-guest cap) is a competitive weakness now, but Zola/The Knot/Joy are free and ad- or registry-funded; Yayatoh cannot win couples on price alone and must win on the connected seat-finder/check-in/day-of chain and planner tooling.


## Open questions

- Who is the primary wedding buyer for Yayatoh: the couple (self-serve, price-sensitive, one event) or the planner/venue/agency (multi-event, white-label, willing to pay $99+/mo)? This decides the pricing ladder and whether the Agency tier ships in P0.
- Do galas on Yayatoh today sell tables (sponsored/hosted tables with the host naming seats) or only individual tickets? This determines whether the HostedTable model is P1 or P0.
- What does the current Laravel seating and seat-finder implementation support (seat-level vs table-level, sections, QR flow, kiosk)? Which existing behaviours must be preserved byte-for-byte for current customers?
- Should SMS/WhatsApp reminders be a metered add-on per event, included in a paid tier, or only available to organisations with their own Twilio/Meta credentials?
- Which markets and languages matter first for the guest-facing RSVP/seat-finder pages (all 12 existing UI languages, or a subset)?
- Is a to-scale floor plan / venue library (Cvent/Prismm territory) a target within 12 months, or is not-to-scale 2D acceptable for the first release?
- Should guests be able to edit their own RSVP after submission and until the deadline, and should the couple be able to lock changes per sub-event?
- Do you want guest photo/video galleries stored on Yayatoh (storage cost, moderation liability) or linked out to third-party albums?
- Will wedding guests ever need tickets/QR entry (e.g., ticketed receptions, large religious or community weddings), which would require the Guest↔Ticket link in P0?
- Is the existing mobile app expected to support wedding check-in (name/party based) in the first release, or is a web kiosk/staff mode sufficient initially?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx (read 2026-09-26)
- https://www.seatfound.com/ (features, Single Event $49 / Agency $99/mo, kiosk, TV sign, offline, Google Sheets sync)
- https://seatfound.com/conferences (booth lookup, one-click layouts, PIN/AES-256, pricing confirmation)
- https://www.seatfound.com/features and /pricing (guest-facing app states: session picker, 'Table Sponsored by', 'View your connections', kiosk prompt)
- https://www.venued.app/ (permanent QR, import, floor-plan upload, tier summary)
- https://www.venued.app/seating-chart-maker
- https://www.venued.app/pricing (Free $0 / Pro $19/mo / Organizer $60/mo)
- https://www.facebook.com/VenuedApp/ (location, via search)
- https://www.zola.com/wedding-planning/seating-chart
- https://www.zola.com/wedding-planning/guests
- https://www.zola.com/faq/115002148572-What-is-the-Guest-List-tool
- https://www.zola.com/faq/360038524532-does-zola-offer-a-seating-chart- (iOS-only)
- https://www.zola.com/faq/360038917171-how-do-i-use-the-zola-seating-chart- (15-guest free cap, seat-level drag)
- https://www.zola.com/expert-advice/best-online-wedding-rsvp-tools (RSVP tool comparison)
- https://www.zola.com/faq/115002222032-... (adults/children breakdown, via search)
- https://www.daisychat.app/what-is-the-knots-guest-list-manager/ (The Knot features/limitations, third party)
- https://table-plan.com/blog/does-the-knot-have-a-seating-chart-tool-best-alternatives-in-2025 (third party)
- https://www.seatcanvas.app/blog/the-knot-seating-chart-alternative (third party, via search)
- https://helpcenter.theknot.com/hc/en-us/articles/40396448675604-Do-you-offer-a-digital-seating-chart (403 — UNVERIFIED)
- https://www.capterra.com/p/176614/RSVPify/pricing/ (RSVPify 2026 tiers)
- https://rsvpify.com/secondary-events/, https://rsvpify.com/seating-chart-maker/, https://rsvpify.com/secure-event-software/, https://help.rsvpify.com/en/articles/5377675-... (403 — content via search summaries)
- https://help.rsvpify.com/en/articles/4853455-secondary-events (403 — via search summary)
- https://withjoy.com/online-rsvp/
- https://withjoy.com/help/en/articles/8343484-guest-list-overview
- https://withjoy.com/help/en/articles/8343360-adding-plus-ones-and-parties
- https://withjoy.com/blog/a-more-sophisticated-online-rsvp-2/
- https://withjoy.com/wedding-website/
- https://withjoy.com/wedding-invitations/ (QR on cards, print from $1.51)
- https://withjoy.com/help/en/articles/14480210-send-text-messages-to-your-guests-with-messaging-plus (via search; price UNVERIFIED)
- https://www.prismm.com/ (features, stats)
- https://www.cvent.com/en/press-release/cvent-acquires-spatial-event-design-technology-provider-prismm (2025-04-24)
- https://community.cvent.com/solution-evolution/cvent-event-diagramming-resources (migration: 2026-05-13, 2026-08-26, June 2027)
- https://floors.live/prismm-alternative/ and https://www.seatplanning.com/blog/seating-chart-software-comparison (third-party: view-only 2026-10-01, shutdown 2026-12-31)
- https://www.socialtables.com/pricing/ (Free/$49/$150/$320/Enterprise, 12-month commitment)
- https://www.socialtables.com/improved-attendee-management/
- https://www.socialtables.com/product/check-in/
- https://www.socialtables.com/product/seat/
- https://www.cvent.com/en/event-marketing-management/cvent-event-design-software (CventIQ, CAD/PDF)
- https://release.cvent.com/eventmanagement/announcements/spotlight-two-way-integration-between-event-registration-and-diagramming (GA 2025-06-04; table/seat on badges)
- https://www.perfecttableplan.com/ and https://www.perfecttableplan.com/html/purchase.html (editions $29.95/$74.95/$299.95)
- https://www.perfecttableplan.com/help/latest/windows/html/automatic_assignment_by_proximity.htm (proximity scores, genetic algorithm)
- https://www.perfecttableplan.com/html/version_7_0_0.html; version 7.1.0/7.2.0 pages via search (v7 2024-05-06; 7.2.1 2025-12-08 UNVERIFIED)
- https://www.toptableplanner.com/features.php
- https://www.toptableplanner.com/purchase.php and /terms.php (from ~$20; Personal 5 plans, Professional 20 plans; 6/12 months)
- https://www.lovelyseating.com/alternatives/top-table-planner (rule types, auto-seat)
- https://seatplan.io/learn/seat-finder (passcode, show tablemates)
- https://www.findyourseat.co.uk/ (Free/£19.99/£49.99 tiers, Tablet Mode, live check-in)
- https://pleasefindyourseat.com/seamless-seating-chart (free ≤50 guests)
- https://findmytable.live/ ($75 flat, via search)
