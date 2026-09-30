# Phase 5 plan — Conference and enterprise

Status: **approved by the owner** (2026-09-29): all eleven decisions (P5-1 to P5-11) accepted as recommended; Wave 1 starts as cloud slots free (Phase 3 first, then Phase 4). Roadmap: `docs/roadmap.md` Phase 5 (M5.1–M5.11). Owner priority 3. Exit (roadmap): a conference of ≥ 500 attendees runs with registration types, agenda, session check-in, badges and lead retrieval, and a SOC 2 Type I report is in hand. Target customer (D20): associations and conventions of 500–5,000, per-exhibitor lead licenses, bring-your-own printers.

## 1. What I'm asking you to decide

| # | Decision | Recommendation |
|---|---|---|
| P5-1 | **When to build.** The roadmap puts Phase 5 after Phase 4 (§8.1). Most of it builds on Phase 1 code that is already merged (program, forms, ticketing, check-in, the Scan PWA) and on Phase 3 plumbing that has merged (realtime publisher, metrics, audiences, surveys). Like Phase 3 (P3-1) and Phase 4 (P4-1), it needs no yayatoh.com cutover. | Yes: build Phase 5 in development now, **behind flags**, in cloud slots Phases 3 and 4 leave free. Phase 3 keeps first claim, then Phase 4. Increments that need unfinished Phase 3/4 work wait for it (section 3 names each). The real-event exit waits for a willing conference, not for B-Y |
| P5-2 | **Badge printing path** (M5.5: "AirPrint, then PrintNode or Zebra"). AirPrint needs no account or install: the browser prints a PDF, from an iPad or any desktop. PrintNode is a paid cloud service (a small client on a venue laptop; any printer, silent printing, printer status). Zebra Browser Print is free but Zebra-only and needs a local agent per workstation. | **Stage 1: PDF + AirPrint/browser print** for every printer (batch PDFs before the event, one-badge PDFs onsite). **Stage 2: PrintNode** as the second adapter behind a `BadgePrinter` port (a fake in dev/CI), switched on per org when you open the account; it also gives the "printer offline" signal. **Zebra Browser Print deferred** until a customer's Zebra fleet needs it. Label sizes supported first: 4×3 in fold-over, 4×6 in, CR80 card; Brother QL (62 mm and 4 in) as label presets |
| P5-3 | **Networking and chat: build or buy.** Providers (Stream, Sendbird) cost per monthly user, hold chat data outside our tenancy model and need their own moderation plumbing. We already have an org-scoped realtime publisher (SSE, Ably later: P3-3), conversations with block and report (M1.10c/d), and chat fraud signals (M1.9e). | **Build in-house** on the realtime port and the messaging module's moderation. Scope: 1:1 attendee chat only **between two people who both opted into the directory and have an accepted connection or meeting**; attendee ↔ exhibitor booth chat. No open group rooms in Phase 5. Rate limits, block, report, and platform review reuse M1.10d. Organizer ↔ customer conversations (M1.10c, the legacy 1:1 chat parity) stay as they are |
| P5-4 | **Lead retrieval licensing and pricing default.** D20 says per-exhibitor licenses. Industry practice is a paid license per scanning user (around $250 each at Cvent, unverified), sold by the organizer to exhibitors. | A **license** is one named scanning seat, reassignable by the exhibitor admin. Default: **1 license included per exhibitor**; the organizer sets how many more each package includes and the price of extra licenses, which exhibitors buy as an **organizer add-on** (the organizer's revenue; today's per-ticket fee applies). Yayatoh charges nothing extra in beta; a `lead_retrieval` `event_addon` entitlement is modeled now so you can price it later with no code change (the P4-4 pattern). Capture opens 24 h before the event and **closes 48 h after it ends**; notes and export stay open **90 days**, then lead access ends (leads kept under D11 retention) |
| P5-5 | **Invoice, PO and pay-later terms default** (M5.1; `payments`). | Pay-later is an organizer opt-in **per registration type** (typically "Member company", "Government"). Default terms **Net 30 from the invoice date, but due no later than 7 days before the event starts**. Optional PO number (the organizer can make it required per type). Partial payments and balance tracking. The pay link is a Checkout Session on the org's normal funds flow (§5.3 hybrid); check and wire payments are recorded by staff (organizer-collected, fee becomes a receivable, as today). Unpaid at the due date: the registration **stays** (never auto-cancelled); badges print and check-in admits only with an audited staff override, and the Command Center shows the balance. Reminders at −7 d, due date and +7 d. Our own invoice PDFs, numbered per org; no Stripe Invoicing (extra fee) |
| P5-6 | **Enterprise readiness is yours to run** (M5.11, D26). Vanta, the auditor, the pen test, the VPAT sign-off and the Data Privacy Framework self-certification need your contracts and signatures. | Yes. **You run** Vanta (per D26: kick off at M3.11, Type I 6–9 months after launch), choose the auditor, commission the pen test ($5–15k, §3.6) **after Waves 1–3 merge** so the portals and chat are in scope, sign the VPAT and file the DPF. **I automate** the evidence: control mapping, CI and access-review exports, audit-log samples, change-management records from PRs, a VPAT draft from the axe and keyboard results, and policy drafts for your review |
| P5-7 | **How speakers, exhibitors and sponsors sign in** (`auth`). They are not org members. The event roles `speaker`, `exhibitor_admin`, `exhibitor_staff` and `sponsor_contact` already exist but nothing uses them. | **Portal accounts by email magic link or code** (the M1.5f guest verification rules), bound to one event role at one event. No org membership, no access to the console, no TOTP. An exhibitor admin invites their own staff up to their badge and license allowance; a sponsor contact sees only their package. Invitations are signed, revocable, and expire with the event (+90 days for lead export) |
| P5-8 | **What a lead scan shares, and consent** (`legal-copy`). The exhibitor becomes the controller of the lead (industry standard). | A scan shares an **allowlist only**: name, job title, company, and email **only if** the attendee agreed at registration ("Exhibitors may receive my email when I let them scan my badge", default **off**, versioned in the consent ledger). Phone and address are never shared. Attendees can see who scanned them and withdraw email sharing afterwards (the exhibitor keeps a stamped record of what was shared). The exhibitor lead terms become a click-through in the exhibitor portal; wording is `legal-copy` for your counsel |
| P5-9 | **Session enrollment defaults** (M5.2). | Included sessions need no enrollment; optional sessions with a capacity do. Waitlist **auto-promotes** the next person when a place frees, with an email, until **24 h before the session starts**; after that the room's door line decides (M5.6). Attendees can "favorite" without enrolling. Conflicting enrollments prompt "replace or keep both" (keep both only when neither has a capacity). Organizers can close enrollment per session |
| P5-10 | **Out of scope for Phase 5.** | Kiosk walk-in registration with payment, NFC/RFID/BLE badges, colour badge printers (Epson), gamification, AI matchmaking (M6.12), CRM lead sync to Salesforce/HubSpot (M6.4/M6.5), CE certificates (M6.9), virtual sessions (M6.9) and native apps (§8.3). CSV lead export and a signed webhook cover integration needs until M6.3 |
| P5-11 | **Paid or free for conferences.** Today's per-ticket fee applies to paid registrations. Conferences need much more (portals, badges, leads). | Free in beta within per-event quotas, with a **"conference pack"** `event_addon` entitlement modeled now (like P4-4) so a price switches on later with no code change. You set the price with D22 |

## 2. Starting point

Phases 1–4 already deliver much of what Phase 5 needs.

**Program (M1.4f, M1.4h)** — `packages/modules/program`, tier 3
- Tracks, rooms (optional capacity), sessions (times as instants, event timezone, optional date of a multi-date event, optional capacity), speakers with bios and links, session ↔ speaker links, exhibitors (free-text booth label), sponsor tiers and sponsors.
- Pure conflict checks in `domain/schedule.ts` (room overlap, speaker overlap, outside the event) as warnings.
- Public agenda and speaker pages through allowlist serializers; speaker photos and exhibitor/sponsor logos through media.
- Not built yet: session types, included/optional, session groups, enrollment, favorites, floor-plan booths, portals, tasks, CFP, packages.

**Registration and forms**
- The forms engine (tier 1): versioned definitions, a safe JsonLogic condition subset, server-side validation that drops hidden fields, sensitive answers in one KeyVault envelope. Kinds today: `checkout_questions`, `survey`. **Single page only**; no per-type paths.
- Ticketing: ticket types with a CHECK that makes overselling impossible, dates, promo codes, claim links and holder links. Orders: holds, lifecycle, snapshotted fees, refund policy, **waitlists with timed offers (M3.10a)**, organizer-collected sales with fee receivables, `created_via`.
- No registration types, admission items, approvals, groups or invoices. The conference profile's **Registration** and **Badges** nav items resolve to the generic placeholder page.

**Check-in and the Scan PWA** (`apps/web/src/app/[locale]/scan`, `scan-app.tsx`; there is no separate `apps/scanner`)
- Checkpoints of kind `entrance` or `zone` (zones check ticket types), scoped scanners (`session_scanner`, `door_staff`), offline manifest v2 with signed scope, first-wins sync, fraud and velocity signals, device heartbeats.
- Event roles already defined: `session_scanner`, `exhibitor_admin`, `exhibitor_staff`, `speaker`, `sponsor_contact`, `kiosk_operator`.
- No session checkpoints, scan-out, or lead capture.

**Phase 3 work already merged**
- M3.1a metrics pipeline (projectors, counters, analytics sink).
- M3.1b realtime publisher (org-scoped channels, Zod-allowlisted payloads, replay; `event.checkins` channel).
- M3.6a audiences (`event_participation`, segment DSL).
- M3.9a surveys, including **one feedback survey per program session**.
- M3.5a messaging rules v2 and M3.10a/b waitlists and refund operations.

**Other building blocks**
- `@yayatoh/pdf` (tickets, receipts), `@yayatoh/floorplan` (layout documents), `@yayatoh/csv`, `@yayatoh/ticket-crypto` (Ed25519 codes for badge QR).
- Guest email OTP and magic links (M1.5f), the consent ledger (M1.5c2), messaging conversations with block/report and platform review (M1.10c/d), chat fraud signals (M1.9e).
- Module keys `registration`, `sessions`, `speakers`, `exhibitors`, `sponsors`, `badges`, `chat` and the `conference` profile nav.

**Phase 3/4 work Phase 5 leans on (not yet merged)**
- M3.2a/b Command Center shell and alert engine: the conference pack (M5.9a).
- M3.3a live mode: live session attendance tiles (M5.9a).
- M3.4a Scan staff mode (staff, supervisor and kiosk modes): session check-in, lead retrieval and kiosk self-print in the PWA (M5.5c, M5.6a, M5.6b).
- M3.5b provider adapters: only for real SMS; everything runs on the fakes meanwhile.
- M3.6b campaigns: no hard dependency; conference audiences simply become targetable once it lands.
- M3.7a journeys: speaker, invoice and enrollment reminders use it if merged, otherwise today's reminder planner (swapped later, as M4.1f does).
- M4.1a+ guests and M4.2a event roles (being merged): M5.1c keeps conference "+1" separate from wedding parties, and M5.3a/M5.4a touch the same event-role code, so they rebase on M4.2a.

## 3. Increments

22 increments in four waves plus a hardening pass, each sized for one agent session and tested end to end (keyboard, axe, Arabic RTL) like Phases 1, 3 and 4. A wave starts when the one before it is merged; increments inside a wave run in parallel. New data lives in:
- `packages/modules/registration` (tier 5): registration types, admission items, registrations, approvals, groups, invoices, enrollments.
- `packages/modules/badges` (tier 5): templates, print jobs, printers, print log.
- `packages/modules/engagement` (tier 4): polls, Q&A, engagement events, networking profiles, connections, meetings, chat.
- `packages/modules/program` (tier 3) grows: session types and groups, capacity counters, speaker tasks, CFP, booths, exhibitor staff, sponsor packages; lead licenses and leads live here too (tier 3 exhibitors per roadmap §3.5), with consent read through a port.

M5.1a writes an ADR fixing this layout (and whether program splits into `sessions`/`speakers`/`exhibitors`/`sponsors`, which the MODULE.md allows). Every new table gets fixture rows for both orgs and every column declared in `private-columns.ts`.

### Wave 1 — registration, agenda and portals on merged code (starts now)
**All seven are independent of unfinished Phase 3/4 work.** M5.3a and M5.4a rebase on M4.2a's event-role changes if it merges first (a small conflict, not a dependency).

| Increment | Scope | Acceptance (roadmap) |
|---|---|---|
| **M5.1a** Registration types and admission items | The `registration` module and the layout ADR. Registration types (who: Member, Non-member, Student, Exhibitor, Speaker, VIP) × admission items (what is bought: full pass, day pass, workshop add-on, dinner), mapped onto ticket types so inventory, orders and check-in stay one system. Per-type capacity (a CHECK like ticketing's), per-type eligibility (access code or email domain), per-type waitlist on M3.10a. The Registration page replaces its placeholder | Per-type capacity never oversells under 50 concurrent checkouts; an ineligible buyer cannot pick a type (enforced in the command) |
| **M5.1b** Multi-page conditional forms | Forms engine: a `registration` form kind with **pages**, conditions across pages, per-registration-type paths, new field types (company lookup, job title list, consent checkbox bound to the consent ledger), save and resume by signed link. Hidden pages' answers dropped server-side | A fixture path shows and validates exactly the right pages for three types; answers on hidden pages are rejected |
| **M5.2a** Agenda model v2 | Program: session types, included vs optional, session groups ("pick one"), per-session capacity counter with a CHECK (`enrolled ≤ capacity`), rooms smaller than capacity warned, bulk agenda CSV import, agenda publishing states | Warnings for rooms smaller than capacity; a session group allows exactly one pick (fixture) |
| **M5.3a** Speaker portal | Portal accounts by magic link or code (P5-7). Speakers edit their profile, photo and session details (organizer approves changes), see their sessions and rooms. Tasks with due dates ("upload slides", "sign release"), files through media, reminders "to whoever is missing X" | A speaker sees only their own event and sessions; a reminder reaches only speakers missing the task |
| **M5.4a** Exhibitor portal | Exhibitor admin and staff portal (P5-7): profile, logo, description, staff invitations up to the allowance, tasks. **Booths on the floor plan**: booth objects in `@yayatoh/floorplan`, assigned to exhibitors (co-exhibitors allowed), public exhibitor map through an allowlist | An exhibitor admin cannot see another exhibitor; staff invites stop at the allowance |
| **M5.5a** Badge designer and batch PDF | The `badges` module. Template designer (keyboard alternative to drag): fields (name, company, title, type, QR, ribbons by type), sizes 4×3 fold-over, 4×6, CR80 and Brother presets; one template per registration or ticket type. Badge QR is the existing Ed25519 ticket code. Batch PDF (sorted A–Z or by company) as a background job on `@yayatoh/pdf` | Golden PDFs for 3 templates in English and Arabic; 1,000 badges render in one job under 2 minutes |
| **M5.11a** Evidence automation | Control mapping (SOC 2 CC series) to repo evidence; scheduled exports of CI runs, branch protection, PR reviews, access lists and audit-log samples; a VPAT (WCAG 2.2 AA) draft from the axe and keyboard suites; policy drafts for your review (P5-6) | An evidence bundle builds from CI with no manual step; no secrets or customer data in it |

### Wave 2 — enrollment, approvals, money, CFP, packages, printing, polls
**Independent of unfinished Phase 3/4 work** (each depends only on Wave 1), except where noted.

| Increment | Scope | Acceptance |
|---|---|---|
| **M5.1c** Approval, groups and +1 | Apply-to-attend states `pending → approved → confirmed` or `denied` with auto-approve rules (email domain, member list), bulk approve/deny with reasons, approval emails. Group registration: one payer, many named registrants, later substitution. Guest (+1) as its own registration type linked to the host registrant (separate from wedding parties; checks M4.1a's model for shared names only) | Bulk approve of 500 is one resumable bulk operation; a denied registrant is never charged |
| **M5.1d** Invoice, PO and pay later | Order states `awaiting_invoice → paid` or `void` (roadmap §5.2), invoice PDFs numbered per org, PO numbers, partial payments and balance, pay link on the org's funds flow, offline payments recorded by staff, terms per P5-5, balance-due flag for badges and check-in with audited override. Reminders on **M3.7a** if merged, otherwise the reminder planner | A $1,200 invoice paid in two parts reconciles to the cent; an unpaid registration is never auto-cancelled; idempotency keys on every pay link |
| **M5.2b** Atomic enrollment and waitlist | Enrollments in `registration`, availability by admission item, atomic claim through program's capacity counter, session waitlist with auto-promotion and close time (P5-9), re-check of availability and conflicts on promotion | **No oversell under concurrency** (200 parallel enrollments for 50 places); **waitlist promotion never loops** (property test); promotion stops 24 h before start |
| **M5.3b** Call for papers | Public CFP form (forms engine), submissions with co-speakers, reviewer assignment (blind option), review scores and comments, decisions with emails; accepting creates the speaker and a draft session | Reviewers see only assigned submissions; an accepted submission creates exactly one session |
| **M5.4b** Sponsor packages and deliverables | Packages as bundles of event-level entitlements: comp registrations (codes), exhibitor badges, lead licenses (P5-4), logo placements, a session slot. Deliverables checklist with due dates and owner; the sponsor portal view; lead-license add-on purchase by exhibitors | Buying "Gold" grants exactly its allowances; overdue deliverables list correctly |
| **M5.5b** Printing and print log | `BadgePrinter` port: AirPrint/browser print adapter and a PrintNode adapter (fake in CI; P5-2). Printers per event, print jobs, print log with reprint reason, printer heartbeat and "printer offline" event (alert rule lands in M5.9a). Onsite reprint from the attendee page | Every print and reprint is in the log with its reason; a printer silent for 90 s emits one offline event |
| **M5.7a** Polls and Q&A | `engagement` module. Server-authoritative polls (single/multi choice, rating, word cloud as counts) and moderated Q&A (submit, upvote, approve, answer, anonymous option) per session over the **merged M3.1b** publisher. Participant, moderator, presenter and big-screen views; signed display link | One vote per person per poll under concurrency; unapproved questions never reach public payloads (leak crawler) |

### Wave 3 — onsite: session check-in, leads, kiosk, networking
**Needs M3.4a merged** for M5.5c, M5.6a and M5.6b (they change the Scan PWA modes it adds). M5.7b, M5.8a and M5.8b are **independent of unfinished Phase 3/4 work** and can start as soon as Wave 2 is merged.

| Increment | Scope | Acceptance |
|---|---|---|
| **M5.5c** Kiosk self-print | Kiosk mode (from **M3.4a**) extended: attendee scans their QR or confirms an email code, checks their details, prints their badge (P5-2 path); balance-due and unapproved registrants sent to the desk; offline snapshot | A kiosk never shows another attendee's details; a printed badge is logged once |
| **M5.6a** Session check-in | Checkpoint kind `session` with **three gates**: registered/enrolled, room capacity, admission level; each with an audited override. Scan in and scan out, dwell time, duplicate detection, offline manifest v3 including session gates (signed scope), self check-in QR flyers as an organizer option (attendance only, no gating) | A full room refuses with `capacity` and allows an audited override; 600 offline session scans sync exactly once |
| **M5.6b** Lead retrieval | In the Scan PWA: exhibitor staff sign in with a license, scan badge QR, see only the P5-8 allowlist, qualifiers, rating, notes, own vs team visibility; offline queue synced exactly once; CSV export with step-up; capture auto-disabled per P5-4; attendee-side "who scanned me" | A lead scanned offline syncs once; a license beyond the allowance is refused; capture stops 48 h after the event; email appears only with consent |
| **M5.7b** Feedback and engagement score | Session feedback prompt at session end (reusing M3.9a session surveys); `engagement_events` from scans, polls, Q&A, feedback, enrollments; an engagement score per attendee and session (documented formula, org-adjustable weights), fed to M3.6a audiences | The fixture attendee's score reproduces exactly; feedback is one response per person |
| **M5.8a** Directory, connections and meetings | Opt-in networking profiles (off by default), search within the event, connection requests, meeting slots and locations with capacity (booths and meeting points), meeting requests and acceptance with ICS; block and report | Someone not opted in never appears (leak crawler); a location never double-books |
| **M5.8b** Chat | 1:1 chat per P5-3 over the realtime port: only between accepted connections or meeting parties, plus attendee ↔ exhibitor booth chat. Rate limits, block, report into the M1.10d platform review, chat fraud signals; message retention per D11 | Chat between unconnected people is refused; a blocked person's messages never deliver; cross-org channel attach denied |

### Wave 4 — Command Center pack, mobile web, hardening
**M5.9a needs M3.2a/b merged (and M3.3a for live attendance tiles).** M5.10a is independent of unfinished Phase 3/4 work.

| Increment | Scope | Acceptance |
|---|---|---|
| **M5.9a** Conference Command Center pack | Widgets and alert rules on the **M3.2b** engine: session ≥ 95 % capacity, waitlist > n, zero-lead exhibitors, exhibitors without staff badges, overdue speaker tasks and sponsor deliverables, rooms smaller than enrollment, printers or kiosks offline, approval backlog, invoices overdue; session attendance live (on **M3.3a**), exhibitor and sponsor activity | Fixtures give exactly "3 sessions are over 95 % capacity" and "5 exhibitors have no leads", each clearing when fixed |
| **M5.10a** Attendee conference hub | One mobile-first page per registrant: agenda, personal schedule (favorites vs enrolled, conflict prompts), signed ICS feed, badge QR, polls and Q&A for the current session, networking entry; installable to the home screen. Native versions stay deferred (§8.3) | Lighthouse mobile thresholds met; the ICS feed updates when a session moves |
| **M5.x** Hardening | The roadmap exit journey end to end (register → approve → pay invoice → enroll → badge print → session check-in → lead scan → poll). Load tests: a 5,000-attendee conference with 40 session rooms, 200 exhibitor devices and 10 kiosks. Accessibility sweep; leak-crawler coverage for every new table; a dress-rehearsal script | E2E, k6 and crawler gates green |

**Timing.** At this project's pace (2–3.5 hours per cloud increment, 2–4 hours per merge batch), the 23 sessions run as **4 waves of about 5–8 hours each**: roughly 50–80 agent-hours plus 10–16 hours of merging, and about **2.5–4 weeks of calendar time** behind Phases 3 and 4. Wave 1 can start as soon as you approve. Wave 3's scanner work waits for M3.4a; Wave 4's pack waits for M3.2a/b. The exit also needs a real conference and the SOC 2 report.

## 4. What waits for you

**Decisions:** P5-1 to P5-11 above. P5-4 and P5-11 (prices) and P5-6 (compliance spend) are yours alone.

**Accounts and hardware:**
- PrintNode, when you want silent printing and printer status (Stage 2 of P5-2).
- Test hardware from §3.6 ($1,500–3,500): an iPad, a Brother QL-820NWB, one 4 in label printer, a laser scanner.
- Live Stripe (invoice pay links, lead-license add-ons), SES and Twilio (already on your list).

**Compliance** (M5.11):
- Vanta contract and auditor for SOC 2 Type I (D26; roadmap estimate ~$800–2,000/month, unverified).
- The pen test ($5–15k), after Waves 1–3 merge.
- VPAT sign-off and the Data Privacy Framework self-certification.

**Legal** (all `legal-copy`, for your counsel):
- Exhibitor lead terms (exhibitor as controller) and the attendee consent to share email with exhibitors (P5-8).
- Invoice terms and late-payment wording (P5-5).
- Speaker release (recording, likeness) and CFP terms.
- Networking and chat terms and the directory privacy notice.

**Numbers:**
- Included and extra lead licenses and their default price (P5-4).
- Invoice terms if not Net 30 / 7 days before the event (P5-5).
- Enrollment close time (default 24 h) and capture windows (48 h, 90 days).
- A conference pack price, whenever you want one (P5-11).

**Real-world exit criterion:** a conference of ≥ 500 attendees run end to end (registration types, agenda, session check-in, badges, lead retrieval). That needs a willing association or convention, ideally 6+ weeks out, your organizer agreement, and an onsite rehearsal with their printers and the venue's Wi-Fi cut.

## 5. Risks

| Risk | Mitigation |
|---|---|
| **Shared files with unfinished Phase 3/4 work** (Scan PWA modes, event roles, forms engine) cause merge conflicts | Scanner increments wait for M3.4a (Wave 3); portal increments rebase on M4.2a; forms changes add a new kind and pages without changing existing kinds |
| **Printing is the most hardware-dependent part**; browser print dialogs and label sizes vary by device | PDF-first with golden files, printer presets tested on your test hardware, PrintNode behind a port; a manual rehearsal script before the first real event |
| **Session enrollment races** (popular sessions open at a set time) | A CHECK on the capacity counter like ticketing's inventory; concurrency and property tests in M5.2b; k6 in M5.x |
| **Lead data is personal data handed to a third party** | Allowlist only, email off by default, consent versioned, "who scanned me" for attendees, export step-up, capture window, counsel's terms (P5-8) |
| **Chat and directory abuse** (spam, harassment) | Opt-in only, chat only after mutual acceptance, rate limits, block/report into existing platform review, chat fraud signals |
| **Invoice money drifts from payments** (partial, offline, late) | Every payment on the existing ledger with idempotency keys; reconciliation to the cent in M5.1d; no auto-cancel |
| **Scope creep toward Cvent-level features** | P5-10 lists what is out; new asks go to Phase 6 or a later milestone |
| **SOC 2 timing** depends on your contracts and the launch date, not on the build | Evidence automation starts in Wave 1 so the audit window is not waiting on engineering |
| **Slot pressure**: Phases 3 and 4 keep first claim | Wave 1 is fully independent and small enough to fill idle slots; nothing in Phase 5 blocks Phases 3 or 4 |
