# Phase 4 plan — Weddings, galas and social events

Status: **Draft for owner approval** (2026-09-28). Roadmap: `docs/roadmap.md` Phase 4 (M4.1–M4.7). Owner priority 2.

## 1. What I'm asking you to decide

| # | Decision | Recommendation |
|---|---|---|
| P4-1 | **When to build.** The roadmap puts Phase 4 after Phase 3 (§8.1), and D28 as widened covers Phase 3 only. Phase 4 barely touches yayatoh.com's legacy data, so it does not need the cutover (B-Y). Its first real wedding or gala can run as a new tenant, the way the M2.1 private beta does. | Build Phase 4 in development now, behind flags, using slots Phase 3 leaves free. Phase 3 keeps first claim on slots. The real-event exit waits for a willing host, not for B-Y |
| P4-2 | **How guests identify themselves to RSVP** (M4.1 lists magic link/QR, strict name lookup and PIN). | Default: **party magic link**. The printed invitation carries the same link as a QR code; links are signed and can be revoked. The fallback for paper-only invitations is **strict name lookup plus the event PIN**: exact full name, the same answer whether or not the name exists, rate limits and a human check (the M1.5f seat-finder rules). There is no fuzzy search and no guest list is ever shown. Hosts can turn name lookup off |
| P4-3 | **Guest data privacy.** Wedding guests give their data to the couple, not to Yayatoh or to a planner's marketing list. | (a) Guests are **never** added to marketing audiences or campaigns. They get RSVP, reminders and day-of messages only. (b) Dietary and accessibility answers and home addresses are encrypted (private columns). (c) The guest site is password-protected, `noindex`, and never on the marketplace (D13). (d) Tablemates appear only to guests signed in through their party link, as the names the host chose. (e) Retention follows D11 until you set a shorter default for social events |
| P4-4 | **Paid or free for weddings.** Today's per-ticket fee earns nothing on a free RSVP event, and subscription tiers wait for D22 and M6.6. | Free while in beta, within per-event quotas (messages, gallery storage). Model a "social pack" as an `event_addon` entitlement now, so a price can be switched on later with no code change. You set the price with D22 |
| P4-5 | **D19: wedding navigation extras and gallery video** (open in roadmap §12). The wedding profile already ships Website, Messages and Day-of as "coming soon" pages. | Accept the three tabs. Video starts as **links only** (YouTube or Vimeo). A Cloudflare Stream adapter waits behind a port until you open the account, which is the roadmap's recommendation, deferred |
| P4-6 | **Gallery storage and moderation** (M4.5 requires a per-event cap but gives no number). | Guest uploads are **held for host approval** by default; the host can switch to auto-publish. Photos from the host are published at once. The per-event cap and the per-guest quota are config placeholders until you give numbers. Guest uploads go straight to R2, so phone photos (HEIC) above today's 4 MB limit work |
| P4-7 | **Google Sheet import** (M4.1). Proper Google OAuth needs the verification the roadmap schedules before M6.4. | Import from a sheet shared as "anyone with the link" (read once as CSV). No OAuth, so no Google verification is needed for Phase 4 |
| P4-8 | **Planner and co-host roles** (M4.2). These are new roles: `auth` and `tenancy` labels. | Two event roles. **Co-host** (the couple or gala chair) gets full access to that event. **Planner** gets guests, RSVP, seating and day-of, but no payouts. A planner working across many clients waits for Agency (M6.7) |

## 2. Starting point

Phases 1–3 already deliver much of what Phase 4 needs.

**Profiles and navigation**
- `wedding` and `gala` profiles with their vocabulary (attendee → guest, registration → RSVP).
- Module keys `guests`, `rsvp`, `seat_finder`, `gallery`, `website`.
- `navIncludes`. The wedding nav items `guests`, `rsvp`, `website`, `gallery`, `messages` and `day-of` are placeholder pages today.

**Seating (M1.7, M1.8f)**
- Floor plan documents with round and rectangular tables, rows, objects, and sections with a VIP flag.
- Guest seat assignment, with keyboard "Seat them" and "Move to…" alongside drag.
- All-or-nothing group seating that reports how many fit.
- Label-based seat blocks and bulk assign (table, section or best seats).
- The live seat feed (Postgres NOTIFY → SSE).
- The seat-finder QR poster.
- On `agent/m1.7g`, **not yet merged**: per-date charts, a floor-plan image underlay, and a Seat column in exports.

**Guest list (M1.8)**
- Attendees linked to CRM contacts; add and remove guests; free-text labels as filter chips.
- Trigram search, bulk email, and staged CSV import with column guessing and a rejected-rows download.
- Not built yet: parties, plus-ones, RSVP status, XLSX or paste import.

**Seat finder and check-in (M1.5f, M1.9)**
- Public seat finder with an email code, uniform responses, lockouts and a human check, plus an optional exact-name mode that returns labels, never names.
- Scan PWA with a service worker and a signed offline manifest.
- The `kiosk_operator` role (no kiosk screen yet). No PIN, no TV board, no check-in by name.

**Site, forms and media**
- Tenant site and CMS pages (Markdown); private-event access codes; 13 locales with Arabic RTL.
- Versioned forms with conditional questions; signed single-use links (surveys, M3.9a).
- Media pipeline (M1.4e): type checks by file content, re-encoding to AVIF/WebP, EXIF stripped, SVGs sanitized; storage port with Postgres and R2 adapters; 1 GiB per org.
- Not built yet: moderation, video, guest uploads, CMS blocks or passwords.

**Messaging and auth**
- Notifications with policy gate, quiet hours, day-before reminders that follow date changes, web push, the message log.
- Guest email OTP and magic links, and `manage_token`.
- Wallet passes (M1.5e2) are **blocked on your Apple and Google accounts**.

**Phase 3 work Phase 4 leans on (not yet merged)**
- M3.1b realtime publisher.
- M3.2a/b Command Center shell and alert engine (Wave B, not started).
- M3.6a audiences (`event_participation.rsvp_status`).
- M3.7a journeys (Wave C, not started).

## 3. Increments

17 increments in four waves. Each is sized for one agent session and tested end to end (keyboard, axe, Arabic RTL) like Phases 1 and 3. A wave starts when the one before it is merged; increments inside a wave run in parallel. All data lives in a new `packages/modules/guests` (roadmap §5.1: parties, guests, sub_events, invitations, rsvp_history, guest_sites, gallery_items, hosted_tables), with fixture rows for both orgs and every column declared in `private-columns.ts`.

### Wave A — guest data and the social workspace (no Phase 3 dependency)
| Increment | Scope | Acceptance (roadmap) |
|---|---|---|
| **M4.1a** Parties and guests | The `guests` module. A party (household, envelope name, side, VIP, tags) holds guests (age class, meal, encrypted dietary and accessibility answers, optional link to an attendee). Placeholder plus-ones. Manual and paper entry recorded with its source. `rsvp_history`. The Guests page replaces the placeholder | Every change is in the history with its source; the isolation suite covers the new tables |
| **M4.1b** Import | Paste, CSV (reuses the M1.8 staging and column guessing), XLSX (a new parser dependency, license-checked), and a Google Sheet shared by link. Rows are grouped into parties by a household column. Rejected rows can be downloaded | Fixture files in all three formats import the same parties |
| **M4.1c** Sub-events and invitations | Sub-events (ceremony, reception, rehearsal dinner) with time, place and an optional date, so each can have its own chart (**builds on unmerged M1.7g**). Invitation matrix of guests × sub-events, with bulk and keyboard editing | A guest not invited to a sub-event cannot RSVP to it (enforced in the command, not only in the UI) |
| **M4.2a** Social workspace | Vocabulary sweep; checklists and templates per profile (onboarding plus readiness rules); co-host and planner event roles (P4-8); a route and API sweep for the wedding profile | A wedding user sees no conference or ticketing modules unless they are enabled |

### Wave B — RSVP, invitations and galas
| Increment | Scope | Acceptance |
|---|---|---|
| **M4.1d** RSVP flow | A mobile-first public RSVP page reached by party link or QR, or by strict name lookup plus PIN (P4-2). Household RSVP: one person answers for the party and names the plus-one. States `invited → sent → viewed → responded`; locked after the deadline. The RSVP status feeds `event_participation` (**M3.6a**) | Name lookup never reveals the guest list (enumeration test); uninvited sub-events are refused |
| **M4.1e** RSVP questions | An `rsvp` form kind on the forms engine; questions per sub-event with conditions; meal choice written back to the guest; sensitive answers encrypted | Conditional questions show and validate correctly in fixtures |
| **M4.1f** Invitations and contact collector | A public contact collector: guests send their address and contact details, and the host approves them into parties (spam-protected). Invitations sent by email or SMS through messaging, tracked as sent and viewed. Deadline reminders run on the **M3.7a** journey engine if it has merged; otherwise on today's reminder planner, swapped later | Reminders stop once a party answers; a collector submission never changes a party without host approval |
| **M4.2b** Gala tables and sponsors | "Tables & Sponsors" and "Tickets" tabs. A table ticket (for example a table of 10) creates guest slots that the buyer names through a claim link. Hosted tables carry a sponsor name. Guests are linked to tickets | Buying a table of 10 gives 10 guest slots; the sponsor name shows on the table in the editor and in the seat finder |

### Wave C — seating and the day itself
| Increment | Scope | Acceptance |
|---|---|---|
| **M4.3a** Guest seating editor | A three-pane editor: an unseated queue (fed by RSVP and meal changes), the map, and table details. Parties are dragged to tables, with a keyboard alternative. "Can't fit" warnings; VIP zones; group assignment. Realtime through the **M3.1b** publisher (or the existing seat feed if it has not merged) | Keyboard-only path works; a plus-one change updates the queue in realtime |
| **M4.3b** Cards and exports | Place, escort and table cards as PDF in common paper sizes (every locale, Arabic RTL). Seating chart by table and caterer meal counts as CSV or XLSX | Golden PDFs for the fixture wedding in English and Arabic |
| **M4.4a** Guest seat finder | The existing seat finder extended for guests: a permanent QR code, map highlight, a PIN mode, and tablemates for guests signed in through their party link only (P4-3) | Unauthenticated lookups never show names; there is no enumeration |
| **M4.4b** Kiosk, TV board and check-in | Kiosk/display mode with an offline snapshot and PIN exit (`kiosk_operator`). An A–Z TV board. Guest check-in by name or party with labels in the Scan PWA. A day-of host view: arrivals, unseated guests, meal counts | The kiosk keeps working after the network is cut (offline drill in Playwright) |

### Wave D — guest site, gallery, Command Center, mobile web
| Increment | Scope | Acceptance |
|---|---|---|
| **M4.5a** Guest website | A block-based guest site: program from the sub-events, travel, registry links, FAQ, a password, all locales. Themed with the design tokens; `noindex`; never on the marketplace | Password gate and locales tested; the leak crawler finds no guest data |
| **M4.5b** Gallery | Uploads by guests and the host through a signed link, sent straight to storage (HEIC accepted). Reuses the re-encoding pipeline. Moderation queue (P4-6). Per-event cap and per-guest quota. A live slideshow over SSE. Video links only; a Stream adapter stub behind a port (P4-5) | The per-event storage cap is enforced |
| **M4.6a** Social Command Center pack | Widgets and alert rules on the **M3.2a/b** alert engine: RSVP pending at deadline −7 d and −1 d, unseated guests, meal and dietary counts, arrivals | The fixture gives exactly "42 guests have not responded to RSVP", which clears as they answer |
| **M4.7a** Mobile-web guest hub | One page per party covering RSVP, seat, tickets and program, installable to the home screen. A Wallet pass port with a fake adapter; live passes need your Apple and Google accounts (M1.5e2) | Lighthouse mobile thresholds met; no app install needed |
| **M4.x** Hardening | The roadmap §13 wedding journey end to end (RSVP → seating → kiosk → check-in). Load tests: a 400-guest wedding and a 1,000-guest gala. An accessibility sweep. Leak-crawler coverage for every new table. A dress-rehearsal script for the first real event | E2E, k6 and crawler gates green |

**Out of scope here:** the gala profile lists a Donations tab, but no donations module exists (only donation ticket types), and no Phase 4 milestone builds one. Tell me if galas need paddle-raise or pledge features, and I'll plan them separately.

## 4. What waits for you

**Decisions:** the eight above, and the D19 row in roadmap §12.

**Accounts:**
- Cloudflare R2, needed for gallery uploads larger than 4 MB and in production.
- Cloudflare Stream, only if you want uploaded video.
- An Apple Pass Type ID and a Google Wallet issuer (M1.5e2).
- SES and Twilio (already on your list), so invitations and reminders really send.

**Legal:**
- Privacy notice wording for guests whose details a host enters.
- Consent text on the contact collector.
- Gallery terms: who owns uploads, and photos of children.
- All `legal-copy`.

**Numbers:**
- Per-event gallery cap and per-guest quota.
- Message quotas for social events.
- Retention for guest data, if shorter than D11.
- A social pack price, whenever you want one (P4-4).

**Real-world exit criterion:** one real wedding or gala run end to end (RSVP → seating → seat finder/kiosk → check-in) by a host who never sees enterprise screens. That needs:
- a willing host, ideally 4 or more weeks out, with 100–400 guests
- your organizer agreement
- a day-of rehearsal on the venue's Wi-Fi with the network cut.

## 5. Timing

The roadmap sized Phase 4 at ~70 small increments over 7–10 weeks for a single-threaded build. At this project's actual pace (2–3.5 hours per cloud increment, 2–4 hours per merge batch including CI fixes), the 17 larger increments above run as **4 waves of about 5–8 hours each**. That is roughly 35–60 agent-hours plus 8–16 hours of merging.

With Phase 3 taking slots first, expect about **1.5–3 weeks of calendar time** if reviews keep pace:
- Wave A can start as soon as you approve.
- Wave B needs M3.6a merged, or it lands the RSVP projection field itself.
- Wave C prefers M3.1b merged.
- Wave D's Command Center pack waits for Phase 3 Wave B.

The exit criterion then depends on the date of a real event.
