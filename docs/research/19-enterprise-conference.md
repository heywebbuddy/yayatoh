# Enterprise Conference

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Enterprise conference feature set (RainFocus, Cvent, Bizzabo, Swoogo, Swapcard, RingCentral Events/Hopin, Whova, Expo Logic) for Yayatoh 2.0

# Enterprise Conference Feature Set — Research Report (Yayatoh 2.0)

Date: 2026-09-26. Grounded in the vision document (`/Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx`), sections 5 (enterprise features "as modules"), 7 (Command Center alerts such as "a session has reached 95% capacity"), 9 (offline-capable check-in), 12 (conference organizer sees Registration | Sessions | Speakers | Exhibitors | Sponsors | Badges | Check-In | Analytics) and 14 (stable mobile API). Vendor pages fetched directly where possible; support.cvent.com articles are JS-rendered and were read via search snippets (marked where relevant).

## 1. What the market actually ships, by feature area

### 1.1 Registration
- **Cvent** separates four concepts, and this separation is the single most useful modelling lesson: *registration types* (who the person is: attendee, speaker, exhibitor staff, press), *registration paths* (which form/experience they get: different questions, payment options, guest/group rules, approval on/off), *admission items* (what they buy: full pass, Monday-only, virtual) and *audience segments*. Registration type can be derived automatically from custom contact fields, contact-group membership or an invitation list; each type must have at least one admission item and can carry its own capacity. Sessions are *included* (auto-added for everyone, e.g. keynote) or *optional* (selectable, may have capacity and fee); *session groups* render as radio/dropdown so a registrant picks exactly one (used to prevent time conflicts); session availability can be limited by admission item ("Monday Only" pass sees only Monday sessions); "Advanced Rules" enforce min/max session counts. Group registration (one payer, many registrants) is a different feature from guest registration (+1s); an "administrator" registering on behalf of others does not count toward capacity. **Registration Approval** puts invitees in a `Pending Approval` status until approved/denied; it cannot be combined with partial payments. Payment modes include credit card, "Offline/Other" (check/PO), paying online later against a balance, importing offline payments and partial payments/installments.
- **Swoogo** advertises "unlimited conditional logic", "endless registrant types", "15+ question formats", and accepts credit card, invoice, check, wire, purchase order or custom payment. Its **Apply to Attend** workflow has statuses `pending → approved → denied/confirmed`, bulk approve/deny, VIP fast-track rules, automatic approval emails carrying a personal registration link, and status sync to HubSpot/Salesforce/Marketo/webhooks. Waitlists auto-promote and send automated session-waitlist emails; a public REST API exposes `Create Session Waitlist Registrant`.
- **RainFocus** sells packages/pricing/attendee types with "rules and exceptions for every one of those things", bulk passes, package waitlists, and attendee self-service (refund requests, tasks, profile). Its Adobe deployments show per-category enrollment caps ("up to three labs and one photowalk", lifted one week before the event if space permits) and paid pre-conference courses sold as add-on orders.
- **Bizzabo**: dynamic flows, group registration, referral incentives, abandoned-cart retargeting. **Whova**: ticket types, discount codes, group registration, invoices, waitlists; third-party sources cite ~3% + $0.99 per paid ticket (UNVERIFIED).

### 1.2 Agenda builder and sessions
The clearest documented pattern is RainFocus as deployed for Adobe Summit/MAX (official FAQ PDFs):
- Catalog filters: format (in-person/online), session type, track, product, technical level (Beginner/Intermediate/Advanced with published definitions), presentation style, audience, business type, industry; MAX adds an "AI Focus" facet. Speaker catalog filters by craft/track/product/region.
- Two distinct actions: **Favorite** (interest, no seat) vs **Add to schedule / Schedule** (reserves a seat). "To secure a seat in any session, you must add it to your personal schedule."
- No double booking: scheduling into an occupied time block prompts "replace the scheduled session?"; you cannot hold a seat and a waitlist entry in overlapping slots.
- **Online waitlist** auto-promotes when a seat opens and emails the attendee; all waitlists are cleared and closed three weeks before the event (attendees told to pick open sessions). **Onsite wait line** is separate: two minutes before start, door monitors admit stand-bys as space allows.
- **Seat-hold rule**: "Your seat will be reserved until three minutes before the session start time. If you fail to arrive three minutes prior, your seat will be forfeited... Your enrollment in a session will be validated and scanned at the time of entry."
- Room assignments are published only the week before the event (rooms are sized to demand after scheduling closes); virtual sessions have no capacity; online-only attendees cannot schedule in-person sessions.
- **Cvent**: capacity per session; session-waitlist notification sent manually or automatically; hybrid nuance — virtual registration types do not count against in-person capacity and cannot join waitlists; and a notable parity gap: **session waitlists are not supported when registering via Attendee Hub** (web/app), only in the registration site. OnArrival (Premium tier) scans attendees into sessions, enforces capacity and shows an alert when the attendee "hasn't registered" but lets staff admit anyway.
- **Expo Pass** (representative onsite vendor) exposes exactly three session gates — *Validate Registrants* (must be on schedule), *Maximum Capacity* (stop scanning at cap), *Registration Level* (pass type must include the session) — plus an "Override Session Scanning" permission; supports scan-in and scan-out to compute percentage of time in room for CE credit.
- **Whova** self check-in: a printed per-session QR flyer at the door; attendees scan with camera/app; it "measures attendance rather than gates access" and feeds certificate generation.
- **Bizzabo**: drag-and-drop multi-day/multi-track agenda embedded on the website; filters by track/day/type; per-session capacity.

### 1.3 Speakers
- **Cvent Speaker Resource Center**: per-session task lists with deadlines, mark-complete, uploads (headshot, bio, slides, signed agreement, links), templated scheduled reminders, custom emails, speaker edits own profile/session details, task/session completion reports.
- **RainFocus Speaker Enablement + Call for Papers** module: abstract submission and review upstream; speakers publish content, run Q&A/polls/reactions in-session; "identify your best speakers with attendee surveys".
- **Whova Speaker Center**: unique per-speaker link (no login), speaker-maintained bio/headshot/slides that auto-sync to web + app, messaging "by role or by what's still missing" (e.g., only speakers without a headshot).
- **Swoogo Call for Speakers**: proposal site with internal review and rating. **Bizzabo**: branded speaker portal collecting bios/assets.

### 1.4 Exhibitors and lead retrieval
- **Cvent Exhibitor Management + LeadCapture**: exhibitor portal with assignable tasks and completion tracking; real-time booth assignment on a floor plan; self-serve booth-staff registration; attendee-initiated appointments with configurable meeting windows; LeadCapture scans badge/business card/manual, per-exhibitor custom qualification questions, 1–5 rating, notes, real-time export and Salesforce sync, multiple staff per license; sold per license per event (~$250/license, third-party, UNVERIFIED), device rental optional.
- **Swapcard Exhibitor Center**: scans QR *or NFC* badges on iOS/Android, captures offline and syncs later, two scan modes (*Qualify* full flow vs *Quick Scan* for rush), survey + notes + lead score at point of scan, shared team dashboard, immediate export, AI-recommended leads (pre-event pipeline), lead-quality scores and "pipeline estimates" at show close. Setup controls: permissions at group level with per-exhibitor override; scanning auto-disabled three months post-event; organizer chooses whether a scan shares contact details both ways or only to the scanner. Exhibitor management portal has roles (primary contact, onsite manager, billing, marketing), staff add/remove "up to event day", client invitation codes with auto-discounts. Interactive floor plan: search by exhibitor/booth number/category/product, point-to-point routing, one exhibitor at multiple booths and co-exhibitors sharing one booth, plus non-booth POIs (stages, lounges, cafés).
- **Whova**: roles *Main Contact* (portal only), *Lead Booth Staff* (onsite lead), *Booth Staff*; two lead-visibility modes (own leads vs all team leads); spreadsheet export; phone-only QR scanning; passport-contest stamps and in-app offers as additional lead channels.
- **RainFocus**: one portal for "contracts, uploaded assets, lead scanner purchases" and tasks; Lead Retrieval app on exhibitors' own devices (scan/edit, custom questions, notes, send collateral); "target lead profile" alerts staff when a matching attendee is scanned; Leads Portal with GDPR posture; the online agreement makes the exhibitor the data controller and forbids any collection except authorized badge scanning.
- **Bizzabo Lead Booster**: QR scan or Klik tap, custom qualification, scoring, notes, CSV export from sponsor portal. **Expo Logic**: LeadPod Pro app unlocked by license key, LeadKey handheld, bundles of 3/5/10/unlimited licenses (2024 SGIM price sheet: ~$1,130–$6,638 per bundle), custom qualifiers ($95) implemented as scannable barcodes.

### 1.5 Sponsors
Whova: tiered packages with "customized visibility", banners in 20+ app locations, ROI report. Cvent: sponsored sessions, packages, automated pre/post emails. Bizzabo: sponsor portal (add-on) tying *entitlements* to experiences and post-event reporting per entitlement. A2Z Events (Personify): sellable package galleries, fulfillment tasks with reminders, collateral collection, progress tracking. Pattern: a sponsorship is a **package of entitlements** (logo slots, sponsored session, badge allotment, lead licenses, push notification, banner) each of which is a trackable deliverable with owner, due date and status.

### 1.6 Badges and printing
- **Designers**: Swoogo (drag-and-drop, auto-align, layers, undo, single/double-sided, one design auto-assigned per registrant type); Whova (17+ templates, live preview, print variant by role); Cvent/RainFocus (branded badges, QR/RFID).
- **Print paths in use**: Swoogo Go Onsite supports AirPrint, Epson, Zebra and **PrintNode** and lists Zebra ZD620/ZD621, Zebra ZC10L, Epson CW-C4000U, Brother QL-1110NWB, Brother QL-820NWB and Rollo Wireless. Whova Kiosk needs iPadOS 17+ iPads, AirPrint printers on the same network, and a flow of tap → enter email/registration ID → confirm → auto-print → custom message; the dashboard shows total check-ins, badges printed, active kiosks. Expo Pass: iOS only, Zebra 203/300 dpi direct thermal, six ZD621 SKUs, "ZD620 discontinued 9/30/21, support ends 12/31/24", notched (not black-mark) stock, 5–10 Mbps, iPads and printers on the same network. Cvent OnArrival: Zebra Link-OS printers (QLn for Bluetooth, ZD500 + cutter for PC) and full-color Epson CW-C4000; offline mode; walk-in registration with onsite payment; "real-time event stats every 15 minutes".
- **Hardware facts**: Zebra ZD621 — 203 or 300 dpi, 8 ips (203) / 6 ips (300), USB/USB-host/Ethernet/serial with optional Wi-Fi + Bluetooth, cutter option, ZPL/EPL. Brother QL-820NWB — 300 dpi, max 2.4"/62 mm width, 110 labels/min, USB/Ethernet/Wi-Fi/Bluetooth 2.1, AirPrint, US$239.99; QL-1110NWB — 4" width, 69 labels/min, AirPrint, auto-cutter. Epson CW-C4000 — 1200 dpi pigment color inkjet, 4"/s, ZPL II compatible, auto-cutter, iOS/Android SDKs. Zebra ZC10L — 3.5×5.5" PVC, 195 color cards/hour. Stock: 4×3 fold-over is 4×6 unfolded, 4×6 is 4×12; "butterfly" badges print two mirrored halves; sensing is notch or black-mark and the printer must be calibrated to the stock.
- **Web-to-printer options**: Zebra Browser Print (JavaScript API, requires client install on the PC, USB + network printers; OS coverage beyond Windows/macOS UNVERIFIED), PrintNode (client on Windows/Mac/Raspberry Pi + REST API, RAW ZPL/EPL or PDF, any vendor), AirPrint from iPad (no driver, image/PDF), Brother Mobile SDK (iOS/Android; Bluetooth to QL-820NWBc/1110NWBc needs SDK ≥4.6.1 and an MFi PPID for App Store apps), Zebra Link-OS Multiplatform SDK, Zebra SendFileToPrinter cloud REST.
- **NFC/RFID**: NTAG213 (144 B, 137 B NDEF) is the default badge chip; NTAG215/216 for larger payloads. Cvent RFID uses door-mounted readers ("attendees just walk past or tap"); Bizzabo Klik is a BLE wearable talking to beacons for heat maps, session tracking and click-to-connect; Swapcard scans NFC as well as QR.

### 1.7 Engagement
- **Cvent Attendee Hub**: chat, Q&A, polls, surveys, session feedback, discussion groups, activity feed with photos/reactions, gamification challenges and leaderboards, personal agenda + 1:1 appointments in one schedule, searchable directory with privacy controls, push notifications, CventIQ recommendations, and **Engagement Score** (points per action — session attended, question asked, resource downloaded, meeting booked — reported as score and "% to most engaged").
- **Swapcard meetings**: organizer-defined non-overlapping slots (5 min–2 h, batch-created); locations are physical, virtual or exhibitor booth, with *capacity = simultaneous meetings per slot*; exhibitor meeting quota = capacity × slots; meeting rules auto-route exhibitor meetings to their booth; attendees mark themselves unavailable; statuses confirmed/pending/declined; "AI Smart Meeting Generator".
- **Brella**: intent-tag matchmaking, one-click propose/accept, automatic meeting-point assignment, five parallel models (open networking, managed meetings, hosted buyer, lead scanning, group meetings).
- **Whova**: polls, surveys (200+ question bank), community board, interest matchmaking, meeting scheduler, speed networking, passport contest (stamp per booth scan), leaderboard contest (points for posts, polls, agenda adds), photo/caption contest, icebreakers.
- **RainFocus**: AI session recommendations, games with points/leaderboard/badges/prizes, logic-based communications, meetings management. **RingCentral Events**: AI-categorized Q&A, reactions, polls, stages, expo booths, "scales to 100,000+". **Bizzabo**: live polls, session chat, AI matchmaking with meetings merged into the agenda, Klik heat maps.

### 1.8 Analytics
Common denominators: registered vs attended per session (scan-in), dwell/percent-in-room (scan-out, RFID or BLE), engagement scoring, exhibitor lead counts/quality/pipeline, sponsor ROI reports (Whova's "50+ page post-event report"), near-real-time check-in stats, CE credit/attendance verification with signatures (Cvent) or certificates (Whova).

## 2. Prioritized feature list for Yayatoh's Conference module

**P0 — credible conference MVP (ships with the Conference event type)**
1. Registration types + admission items + conditional questions (page/field show-hide by type/answer), discount codes, group registration with single payer, guest (+1) registration, per-type capacity, event waitlist.
2. Approval workflow (`pending/approved/denied/confirmed`, bulk actions, auto-approve rules, approval email with personal registration link).
3. Invoice/PO/"pay later" payment method with balance tracking, offline-payment recording and post-registration online payment.
4. Agenda: tracks, session types, rooms, time slots, speakers, capacity, included vs optional sessions, session groups (pick one), availability by admission item, personal schedule with conflict prompt, favorites vs scheduled, ICS export.
5. Session reservation with capacity enforcement (atomic), online waitlist with auto-promotion + notification, configurable waitlist close date, per-attendee enrollment caps per session category.
6. Speaker portal via magic link: profile, headshot, bio, slides, per-session tasks with due dates, reminders "to whoever is missing X".
7. Exhibitor portal: company profile, booth number, staff registration/badge allotment, tasks/deliverables, lead-retrieval licenses.
8. Lead retrieval in the Yayatoh mobile app: QR scan, offline queue, qualification questions, rating, notes, CSV export, exhibitor-level permissions (own vs team leads), consent/data-sharing setting.
9. Badge designer with per-registration-type templates, QR encoding, batch PDF (4×3 fold-over and 4×6), and on-demand printing at check-in via AirPrint (iPad) and PrintNode/Zebra Browser Print (desktop); print log and reprint with reason.
10. Session check-in with the three gates (on-schedule, capacity, pass level), override permission, duplicate-scan detection, offline operation — reusing the existing check-in engine.
11. Sponsors as packages of entitlements with a deliverables checklist and logo placement on event pages/app.
12. Analytics: registration funnel, session registered/attended/no-show, room utilization, lead counts per exhibitor, and Command Center alerts (session ≥95% capacity, waitlist > n, speakers with overdue tasks, exhibitors without staff badges).

**P1 — differentiators expected within a year**
Live polls/Q&A/session feedback in the app; attendee directory with privacy controls and messaging; 1:1 meeting scheduling with slots, locations and booth routing; call for papers with reviewer scoring; interactive floor plan with booth search and routing; scan-out/dwell time and CE certificates; engagement score; kiosk self check-in with walk-in registration and onsite payment; gamification (passport stamps, leaderboard); Salesforce/HubSpot lead sync; sponsor ROI report.

**P2 — enterprise/scale**
NFC badges (NTAG213) and NFC lead scanning; RFID door readers or BLE wearables for passive tracking; AI session recommendations and matchmaking; hosted-buyer programs; virtual/hybrid stages with virtual-only capacity rules; full-color Epson badge printing; lead-quality scoring/pipeline estimates; multi-event portfolio analytics.

## 3. UX patterns worth copying
- Keep *who you are* (registration type), *what you bought* (admission item) and *which form you see* (path) as separate settings; derive type automatically from invite list or email domain where possible (Cvent).
- Catalog-first agenda with faceted filters and a published "technical level" legend; two verbs (Favorite vs Schedule); replace-on-conflict dialog; "Scheduled" toggle to remove (RainFocus).
- Publish written seat rules in the product (hold until T-3 min, wait line at T-2 min, waitlists close N weeks out) and enforce them by scan at the door.
- Speaker and exhibitor portals reached by unique links, with a task checklist and "message everyone missing item X" (Whova/Cvent).
- Two lead-scan modes (full Qualify vs Quick Scan) and a scan that works offline (Swapcard).
- Kiosk flow: tap → identify (email/ID/QR) → confirm details → print → instructions; organizer sees badges printed and active kiosks live (Whova).

## 4. Data-model implications
See the structured list; core additions are `registration_type`, `admission_item`, `registration_path`/form rules, `approval`, `invoice`, `session` with `track/room/session_type/capacity/waitlist_policy`, `session_enrollment` (status scheduled|waitlisted|attended|no_show, seat_hold_until), `speaker`, `speaker_task`, `exhibitor`, `booth`, `exhibitor_staff`, `lead` (+ `lead_answer`), `sponsor_package`/`entitlement`/`deliverable`, `badge_template`, `badge_print_job`, `session_scan` (in/out), `meeting_slot`/`meeting_location`/`meeting`, `engagement_event`.

## 5. Pitfalls
1. **Session capacity race**: read-then-write is not atomic; use a `SELECT ... FOR UPDATE` on the session row (or a conditional `UPDATE ... WHERE reserved < capacity`) inside one transaction, and a short-TTL hold for checkout flows. Same primitive for ticket inventory.
2. **Waitlist promotion loops**: auto-promotion must re-check the attendee's schedule for conflicts and enrollment caps, expire unclaimed promotions, and close at the configured date.
3. **Feature parity across surfaces**: Cvent's own gap (no session waitlists in Attendee Hub) shows why web and the Yayatoh mobile app must share one enrollment API.
4. **Attendance ≠ access control**: per-session QR flyers (Whova) count attendance; gating requires staff scanning or readers. Model both.
5. **Badge printing hardware**: iPads and printers must be on the same LAN (venue Wi-Fi often isolates clients); AirPrint cannot print offline; direct-thermal stock must match sensing type and be calibrated; ZD620 is end-of-support; Zebra Browser Print and PrintNode need a client install on a laptop; Bluetooth Brother printing from a native app needs the MFi PPID; fold-over badges need mirrored layouts; keep a print queue with reprint audit.
6. **Lead data governance**: exhibitor becomes data controller; require attendee consent at scan, one-way vs two-way sharing setting, license limits per exhibitor, auto-disable scanning after the event, and per-tenant retention.
7. **Hybrid capacity**: virtual registrations must not consume physical seats or waitlists.
8. **Room assignment timing**: allow sessions without rooms until late; alert on room capacity < enrollments.
9. **Vendor pricing** (Bizzabo, Whova, Cvent LeadCapture, Expo Logic) came from third-party pages or PDFs and is UNVERIFIED.



## Key recommendations

- Model registration as Cvent does: registration_type (who) x admission_item (what they bought) x registration_path/form rules (what they see); derive type from invite list/email domain. Runner-up: single ticket-type model like Yayatoh today, loses because it cannot express speaker/exhibitor/press flows or per-type capacity.
- Ship session reservation with atomic capacity enforcement (SELECT FOR UPDATE or conditional UPDATE) plus online waitlist with auto-promotion, conflict re-check, expiry, and a configurable waitlist close date; publish RainFocus-style seat rules (hold until T-3 min, wait line at T-2) and validate by scan at the door.
- Expose one enrollment/waitlist API used by both web and the Yayatoh mobile apps to avoid Cvent's parity gap (no session waitlists in Attendee Hub).
- Reuse the existing check-in engine for session check-in with three gates (on-schedule, capacity, pass level), an override permission, duplicate-scan detection and offline queueing; add scan-out later for dwell time and CE credit.
- Build lead retrieval into the existing Yayatoh mobile app (QR now, NFC NTAG213 later): offline queue, Qualify vs Quick Scan modes, per-exhibitor qualification questions, rating/notes, CSV export, own-vs-team lead visibility, consent and one-way/two-way sharing settings, auto-disable N days post-event.
- Badge printing: start with AirPrint from iPad kiosks (Brother QL-820NWB/QL-1110NWB, Zebra ZD621) and PrintNode/Zebra Browser Print for desktop stations; render badges as PDF/PNG server-side from per-registration-type templates; keep a print job log with reprints. Runner-up: native Zebra/Brother SDK integration in the app, defer until volume justifies MFi/Link-OS work.
- Speaker and exhibitor portals via unique magic links with task checklists, due dates, uploads and 'message everyone missing X'; add call-for-papers as P1.
- Treat sponsorships as packages of entitlements with a deliverables checklist (owner, due date, status) so the Command Center can alert on unfulfilled deliverables; add ROI report as P1.
- Command Center alerts for the Conference module: session >= 95% capacity, waitlist length, speakers with overdue tasks, exhibitors without staff badges, rooms with capacity < enrollments, printers/kiosks offline.
- Defer to P2: NFC/RFID/BLE passive tracking, AI matchmaking, hosted-buyer programs, full-color Epson badges, virtual stages; keep the schema ready (session_scan direction, lead.source, meeting_location.capacity).
- Gate the whole Conference module behind the event-type/module system so concert and wedding organizers never see sessions, exhibitors or badges (vision doc sections 5 and 12).


## Data model implications

- registration_type (event_id, name, capacity, is_public, auto_assign_rules[email_domain, invite_list, custom_field], requires_approval, badge_template_id) and admission_item (event_id, name, price, includes_session_ids, available_registration_type_ids, session_availability_rules)
- registration_form / form_page / question with conditional visibility rules keyed on registration_type, admission_item or prior answers; question types incl. file upload and consent
- registration (tenant_id, event_id, contact_id, registration_type_id, admission_item_id, status: pending_approval|approved|denied|confirmed|cancelled|waitlisted, group_id, primary_registrant_id, guest_of_registration_id, approval_decided_by, approval_decided_at)
- invoice / payment with method: card|invoice|po|check|wire|offline, balance_due, due_date, po_number, partial payments; offline_payment import
- track, session_type, room (venue_id, capacity), session (event_id, track_id, session_type_id, room_id nullable until assigned, starts_at, ends_at, capacity, is_included, session_group_id, fee, waitlist_enabled, waitlist_closes_at, seat_hold_until_minutes_before_start, allowed_admission_item_ids, allowed_registration_type_ids, level, tags, is_virtual)
- session_group (pick-one constraint) and enrollment_cap_rule (event_id, session_category, max_per_attendee, lifted_at)
- session_enrollment (session_id, registration_id, status: scheduled|waitlisted|promoted_pending|attended|no_show|cancelled, waitlist_position, promoted_at, promotion_expires_at, seat_hold_until) with unique(session_id, registration_id) and atomic capacity check
- favorite (registration_id, session_id) separate from enrollment
- speaker (contact_id, bio, headshot, company, title, portal_token), session_speaker (role: speaker|moderator|panelist), speaker_task (speaker_id, session_id nullable, type, due_at, status, file_id), call_for_papers_submission + review_score (P1)
- exhibitor (event_id, company, tier, booth_id, portal_token, lead_license_count, scanning_enabled_until, contact_sharing_mode: one_way|two_way), booth (floor_plan_id, number, polygon, co_exhibitor support), exhibitor_staff (exhibitor_id, contact_id, role: primary|onsite_manager|billing|marketing|booth_staff, badge_allotment)
- lead (exhibitor_id, scanned_by_staff_id, registration_id, source: qr|nfc|manual|business_card, rating, notes, scan_mode: qualify|quick, consent_given, captured_offline_at, synced_at), lead_qualifier_question (exhibitor_id) and lead_answer
- sponsor_package (event_id, name, price, entitlements[]), sponsorship (exhibitor_id or sponsor_id, package_id, status), deliverable (sponsorship_id, type, owner, due_at, status, asset_file_id)
- badge_template (tenant_id, size: 4x3|4x6|custom, sides, layout_json, qr_payload_spec, applies_to registration_type_ids), badge_print_job (registration_id, template_id, printer_id, kiosk_id, status, printed_at, reprint_reason)
- printer / kiosk device registry (event_id, type: airprint|printnode|browserprint|zebra_sdk, last_seen_at) for Command Center device alerts
- session_scan (session_id, registration_id, direction: in|out, scanned_at, device_id, gate_result: ok|not_scheduled|capacity|pass_level|duplicate, overridden_by) feeding attended/dwell metrics and CE credits
- meeting_slot (event_id, starts_at, ends_at, non-overlapping), meeting_location (type: physical|virtual|booth, capacity = simultaneous meetings), meeting (requester, invitee, slot_id, location_id, status: pending|confirmed|declined|cancelled), availability_block
- engagement_event (registration_id, type: session_attended|question|poll|download|meeting|booth_visit, points, occurred_at) with per-event scoring config; poll, question, survey_response entities
- event_module_enabled (event_id, module: sessions|speakers|exhibitors|sponsors|badges|leads|meetings|engagement) driving navigation per event type


## Risks

- Overselling session seats or tickets under concurrent load if capacity checks are not atomic (documented race condition in ticketing systems).
- Waitlist auto-promotion creating schedule conflicts or exceeding per-attendee enrollment caps if promotion logic does not re-validate.
- Web/mobile feature drift (Cvent's own Attendee Hub lacks session waitlists) if enrollment logic is duplicated rather than shared via one API.
- Onsite printing failures: venue Wi-Fi client isolation blocks iPad-to-printer traffic; AirPrint needs connectivity; wrong stock sensing (notch vs black mark) causes misfeeds; Zebra ZD620 support ended 12/31/24.
- Native Bluetooth printing from the Yayatoh iOS app to Brother printers requires Brother MFi PPID and SDK >= 4.6.1; Zebra native printing requires Link-OS SDK work; both add app-release dependencies.
- Lead-retrieval privacy exposure: exhibitors become data controllers; missing consent capture, unlimited sharing or no post-event scanning cut-off create GDPR/CCPA and tenant-trust risk.
- Hybrid events: virtual registrations consuming physical seats or waitlists if capacity is not scoped by format.
- Scope creep: enterprise features (NFC/RFID/BLE, AI matchmaking, virtual stages) can delay the P0 conference MVP; module gating must be enforced from the start.
- Third-party pricing figures (Bizzabo, Whova, Cvent LeadCapture, Expo Logic) are UNVERIFIED and may misguide packaging decisions.
- Session self check-in via public per-session QR (Whova style) can be spoofed/shared; treat as attendance signal, not access control.


## Open questions

- Which conference customers (associations, corporate user conferences, church conferences) are the first targets, and what attendee scale (500? 5,000?) should the P0 module be sized for?
- Will Yayatoh sell lead-retrieval licenses to exhibitors per event (Cvent/Expo Logic model) or include it in the organizer's plan? This drives the license/billing entities.
- Should badge printing be positioned as bring-your-own-printer (AirPrint/PrintNode) only, or will Yayatoh rent/sell hardware kits (Cvent 'Event in a Box', Swoogo 'Go Box')?
- Do the existing iOS/Android apps need to become the exhibitor lead-scanner and session-scanner app, or will there be a separate staff/exhibitor app?
- Is invoice/PO payment required at launch for B2B conferences (Maryland/DC associations and government-adjacent buyers), and who handles collections/dunning?
- Do target customers require CE/CEU credit tracking with scan-out and certificates (common for professional associations)?
- How important is virtual/hybrid (streams, virtual-only capacity) for the first conference customers versus strictly in-person?
- Which CRM integrations must exist at launch for approval-status and lead sync (Salesforce, HubSpot are the ones vendors sync first)?
- What consent language and data-retention policy should govern exhibitor lead data per tenant, and should attendees be able to opt out of badge scanning?
- Should speakers/exhibitors get passwordless portal links (Whova model) or full tenant user accounts with roles?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
- https://www.rainfocus.com/platform/
- https://www.rainfocus.com/platform/registration/
- https://www.rainfocus.com/platform/attendee-engagement/
- https://www.rainfocus.com/platform/speaker-enablement/
- https://www.rainfocus.com/platform/sponsor-activation/
- https://www.rainfocus.com/platform/on-site-experience/
- https://static.rainfocus.com/adobe/m24/static/staticfile/staticfile/MAX%202024%20Sessions%20and%20Scheduling%20FAQ_1718141131237001UF52.pdf
- https://static.rainfocus.com/adobe/as24/static/staticfile/staticfile/Summit%202024%20Sessions%20FAQ_1698183449908001Bti0.pdf
- https://static.rainfocus.com/Lead_Retrieval_Services_Online_Agreement.pdf
- https://support.cvent.com/s/communityarticle/When-should-I-use-registration-types-vs-registration-paths
- https://support.cvent.com/s/communityarticle/Adding-Registration-Types
- https://support.cvent.com/s/communityarticle/The-Complete-Guide-to-Sessions
- https://support.cvent.com/s/communityarticle/Limiting-Options-Based-on-Admission-Items
- https://support.cvent.com/s/communityarticle/Managing-Session-Waitlists
- https://support.cvent.com/s/communityarticle/Setting-Up-Registration-Approval
- https://support.cvent.com/s/communityarticle/Setting-Up-Partial-Payments
- https://support.cvent.com/s/communityarticle/Paying-Online-After-Registration
- https://support.cvent.com/s/communityarticle/Importing-Offline-Payments
- https://support.cvent.com/s/communityarticle/Choosing-Between-Group-and-Guest-Registration
- https://support.cvent.com/s/communityarticle/Can-I-check-attendees-in-to-sessions-they-didn-t-register-for
- https://support.cvent.com/s/communityarticle/Using-Engagement-Scoring
- https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software
- https://www.cvent.com/en/event-marketing-management/onsite-solutions
- https://www.cvent.com/en/event-management-software/speaker-resource-center
- https://www.cvent.com/en/event-marketing-management/exhibitor-management
- https://www.cvent.com/en/event-marketing-management/lead-capture
- https://www.cvent.com/en/event-marketing-management/attendee-hub
- https://www.cvent.com/en/event-marketing-management/engagement-score
- https://www.barcodefactory.com/solutions/software/cvent-compatible-printer-solution
- https://release.cvent.com/eventmanagement/board/registration-approval
- https://www.swoogo.events/features
- https://swoogo.events/mobile/go-onsite/
- https://swoogo.events/blog/onsite-event-upgrades-swoogo/
- https://swoogo.events/event-registration-software/apply-to-attend/
- https://swoogo.events/product-updates/automated-session-waitlist-emails/
- https://swoogo.readme.io/reference/createwaitlistregistrant
- https://www.bizzabo.com/product
- https://www.bizzabo.com/event-management-software/klik-smart-event-badges
- https://www.bizzabo.com/event-management-software/lead-capture-app
- https://www.swapcard.com/features/exhibitor-center
- https://www.swapcard.com/features/exhibitor-management-portal
- https://www.swapcard.com/features/interactive-floorplan-for-events
- https://help.swapcard.com/en/articles/8158993-setting-up-lead-capture
- https://help.swapcard.com/en/articles/8159041-creating-meeting-slots
- https://help.swapcard.com/en/articles/8159042-creating-meeting-locations
- https://release.swapcard.com/manage-multiple-locations-for-one-exhibitor-and-one-booth-for-multiple-co-exhibitors-1AGmk0
- https://www.ringcentral.com/rc-events.html
- https://whova.com/features/
- https://whova.com/event-management-software/
- https://whova.com/event-management-software/event-badge-printing-software/
- https://whova.com/blog/kiosk-check-in-badge-printing/
- https://whova.com/blog/session-self-check-in/
- https://whova.com/trade-show-app-lead-retrieval/lead-retrieval-app/
- https://whova.zendesk.com/hc/en-us/articles/30709333208091
- https://whova.com/event-management-software/event-speaker-center/
- https://whova.com/blog/best-event-gamification-ideas/
- https://www.expologic.com/
- https://www.sgim.org/wp-content/uploads/2024/10/ExpoLogic-Lead-Retrieval-Pricing.pdf
- https://expologic.zendesk.com/hc/en-us/articles/23160307562637-Lead-Retrieval-FAQ
- https://support.expopass.com/en/articles/8363118-bring-your-own-equipment-byoe-overview
- https://support.expopass.com/en/articles/882708-session-attendance-tracking
- https://www.expopass.com/conference-attendance-ce-tracking/
- https://www.expopass.com/articles/event-badge-terminology-guide-2026
- https://www.brella.io/event-matchmaking
- https://mya2zevents.com/solutions/sponsor-management-software/
- https://www.zebra.com/us/en/products/spec-sheets/printers/desktop/zd600-series.html
- https://developer.zebra.com/content/print-web-application
- https://www.zebra.com/us/en/products/printers/card/zc10l.html
- https://www.brother-usa.com/products/ql820nwb
- https://www.brother-usa.com/products/ql1110nwb
- https://developerprogram.brother-usa.com/sdk-download
- https://epson.com/For-Work/Printers/Label/ColorWorks-CW-C4000-Color-Inkjet-Label-Printer-(Matte)/p/C31CK03A9981
- https://www.printnode.com/en
- https://store.gototags.com/nfc-pvc-badge-ntag213-horizontal/
- https://medium.com/@lahsaini/never-oversell-a-ticket-647a096e7285
- https://dev.to/iurii_rogulia/preventing-overselling-inventory-locks-under-concurrent-checkouts-3m7e
- https://www.getapp.com/sales-software/a/cvent-leadcapture/ (pricing, UNVERIFIED)
- https://eventify.io/blog/whova-pricing (pricing, UNVERIFIED)
- https://www.stackscored.com/pricing/event-management/bizzabo/ (pricing, UNVERIFIED)
