# Phase 4 plan — Weddings, galas and social events

Status: **approved by the owner** (2026-09-28): all eight decisions accepted; Wave A started. The owner also asked for gala donations (paddle raise, pledges) to be planned. Section 6 adds that plan: **its decisions P4-9 to P4-17 await the owner's approval**. Roadmap: `docs/roadmap.md` Phase 4 (M4.1–M4.7). Owner priority 2.

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

17 increments in four waves, plus 7 gala donation increments (section 6) that join Waves B–D. Each is sized for one agent session and tested end to end (keyboard, axe, Arabic RTL) like Phases 1 and 3. A wave starts when the one before it is merged; increments inside a wave run in parallel. All data lives in a new `packages/modules/guests` (roadmap §5.1: parties, guests, sub_events, invitations, rsvp_history, guest_sites, gallery_items, hosted_tables), with fixture rows for both orgs and every column declared in `private-columns.ts`.

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

**Gala donations:** the gala profile lists a Donations tab, but no donations module exists (only donation ticket types), and no roadmap milestone builds one. The owner asked for it to be planned (2026-09-28). **Section 6** plans it: decisions P4-9 to P4-17 and increments M4.8a–M4.8g, which join Waves B–D.

## 4. What waits for you

**Decisions:** the eight above, the D19 row in roadmap §12, and the gala donation decisions P4-9 to P4-17 (section 6).

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

The 7 gala donation increments (section 6) run inside Waves B–D and add about 15–25 agent-hours plus 2–4 hours of merging. **Phase 4 in total: 24 increments, roughly 50–85 agent-hours plus 10–20 hours of merging.**

With Phase 3 taking slots first, expect about **2–3.5 weeks of calendar time** if reviews keep pace:
- Wave A can start as soon as you approve.
- Wave B needs M3.6a merged, or it lands the RSVP projection field itself.
- Wave C prefers M3.1b merged.
- Wave D's Command Center pack waits for Phase 3 Wave B.

The exit criterion then depends on the date of a real event.

## 6. Gala donations (added at the owner's request)

Status: **awaiting the owner's approval** (planned 2026-09-28). Roadmap: none yet; this adds M4.8 to Phase 4.

**How gala fundraising works in practice.** Most of a gala's money is raised in the room, not from tickets:
- **Fund-a-need (paddle raise).** After dinner, the host or a hired auctioneer calls giving levels from the top down ("$10,000 to fund a classroom… $5,000… $1,000… $250"). Guests raise a numbered paddle. Spotters call the paddle numbers; a recorder writes them down. A thermometer on the screens climbs toward the goal. Often a sponsor has promised to **match** gifts up to a cap, which the host announces to lift the room.
- **Give from the table.** A QR code on the table card or on the screen, or a text keyword, opens a giving page on the guest's phone.
- **Pledges are promises.** The paddle raise records who promised what. The money is collected afterwards: charged to a card the guest saved at check-in or at ticket purchase, or paid against an invoice or pledge letter. Some pledges arrive as a check, a stock transfer or a donor-advised fund grant weeks later. Some never arrive and have to be chased politely, then written off.
- **Gift types.** Gifts can be anonymous, made in honor or in memory of someone (a **tribute**, with a note to the family), or matched by the donor's employer.
- **Acknowledgement and receipts.** US charities must give donors a written acknowledgement for gifts of $250 or more. When the donor received something in return, such as a gala dinner, and paid more than $75, the charity must also state the **fair-market value** of what the donor received; only the rest is deductible. A $500 ticket for a dinner worth $150 gives a $350 deduction. A paddle-raise gift with nothing in return is fully deductible.
- **After the night.** The charity reconciles pledges to payments and payouts, sends thank-you letters, and exports donors into its own donor CRM.

Silent and live **auctions** are a different feature (items, bidding, winners' checkout, item values on receipts). They are out of scope here (P4-16).

### 6.1 What I'm asking you to decide

| # | Decision | Recommendation |
|---|---|---|
| P4-9 | **Merchant of record and funds flow for donations** (roadmap §5.3 hybrid model). A gift to a charity should land in the charity's own Stripe account, under the charity's name, at Stripe's nonprofit rate if the charity has it. If Yayatoh took gifts on its platform account (`platform_mor`) and transferred them later, Yayatoh would hold charitable money. That can make it a regulated "charitable fundraising platform" (for example, California's AB 488 registration) and adds money-transmission questions. | Donations run **only as `organizer_mor` direct charges on the organizer's connected account**, like tickets for connected organizers. **Unconnected organizers** cannot switch on online giving, the giving page, QR-to-give or card charges: the Donations tab asks them to connect Stripe first. They can still run a paddle raise that records pledges and collect them outside Yayatoh (check, their own invoice), recorded as offline payments; no money passes through Yayatoh. Existing donation ticket types keep selling as today under the org's funds flow, but on `platform_mor` they get no tax-deductibility wording. Taking donations under `platform_mor` waits for counsel |
| P4-10 | **Does Yayatoh take a fee on donations?** Tickets carry today's per-ticket fee. Charities and donors watch fees on gifts closely, and "tip the platform" boxes draw complaints and regulators' attention. **This is your call.** | **No Yayatoh fee on donations** (application fee 0). The donor may tick **"Cover the processing fee"** (off by default, shows the exact amount, goes to the charity). No platform tip. If you want revenue from giving later, model it as a transparent percentage the organizer agrees to in the organizer agreement, shown on the giving page, and switched on per org as an entitlement (the P4-4 pattern), never hidden from the donor. Ticket fees are unchanged |
| P4-11 | **Tax receipts** (`legal-copy`). Receipts are the charity's statement, not Yayatoh's. | Receipts only for orgs with a **verified charity profile**: legal name, EIN, 501(c)(3) status checked against the IRS exempt-organization list (a public bulk file) and confirmed by staff, plus an optional fiscal sponsor. One receipt per payment (not per pledge): charity name and EIN, donor, date, amount, and either "No goods or services were provided in exchange for this contribution" or a description and good-faith **fair-market value** of what was received, with **deductible amount = amount paid − fair-market value** (never below zero). Ticket types get a fair-market value field; a gala ticket needs one before receipts turn on. Ticket pages over $75 show the quid-pro-quo notice before purchase. Orgs without a verified profile get a plain payment receipt: "This payment is not tax-deductible". US and USD only at first. A year-end giving statement per donor. **All wording is `legal-copy` for your counsel** |
| P4-12 | **Pledges paid later, and chasing unpaid ones.** | A pledge is a promise, never a charge. Two ways to collect: **(a) card on file** (P4-14): at the end of the night each donor gets a summary ("You pledged $1,000. We will charge your card ending 4242 tomorrow at 9:00"), with a link to change the card or pay another way; the charge runs the next morning in the event's timezone. **(b) Invoice**: a pledge email with a pay link (a Checkout Session on the connected account) and a due date (default 30 days). The host can record offline payments (check, wire, stock, donor-advised fund) or write a pledge off with a note. **Chasing:** transactional reminders at +7, +21 and +28 days that stop the moment it is paid; a declined card is retried once, then gets a pay link; after the due date the host gets an alert. Yayatoh never charges more than pledged, never charges without the saved consent, and never sends pledges to a collection agency |
| P4-13 | **Anonymity and donor privacy.** | Donors choose how they appear: their name, a custom name ("The Smith Family"), or **Anonymous**. **Screens show totals and gift counts only by default**; a name appears on the thermometer or a shout-out only if the donor opted in. No donor list ever appears on a public page or payload. Spotters' phones see paddle numbers, never names or amounts given before. The organizer always sees who gave (receipts need it); amounts and tribute notes are private columns. The donor list is the charity's: Yayatoh never markets to it, and donors join the charity's own marketing only with a separate consent (the M1.5c2 consent ledger) |
| P4-14 | **Cards saved for one-tap giving** (`payments` and `legal-copy`: needs your approval). Saving a card turns a raised paddle into collected money and is how gala platforms raise most of their total. | Yes, **opt-in only**, and always on the guest's own device. Two entry points: a "Save my card for tonight's giving" box at ticket checkout, and a QR code at check-in or on the table that opens a card-saving page. Both use a Stripe **SetupIntent on the charity's connected account** for off-session use, and store the consent text version, time and event. Yayatoh stores only the provider's reference, never card data. Staff never type card numbers; card readers (Stripe Terminal) wait for later. Saved cards are used only for gifts at that event, and are removed from the charity's customer 30 days after it |
| P4-15 | **Text-to-give.** A short code or 10DLC keyword needs a carrier-approved messaging campaign. | **QR-to-give now** (no carrier approval, same giving page). An SMS keyword that replies with the giving link comes later on the M3.5b Twilio adapter, once your 10DLC charity campaign is approved. No carrier-billed giving (charges on the phone bill) |
| P4-16 | **Silent and live auctions.** | **Out of scope for Phase 4.** Fund-a-need covers most gala giving and needs no item catalogue, bidding engine or item values on receipts. Auctions become their own milestone after Phase 4 if real galas ask for them; `donations.source` leaves room for `auction` |
| P4-17 | **Matching gifts.** | Build **challenge matches**: a sponsor's pledge to match gifts in a window, up to a cap. The console and screens show "Every gift doubled up to $25,000"; the match is the sponsor's own pledge, collected like any other. **Employer matching**: donors may name their employer, and the charity exports the list. A paid matching-gift database integration (for example Double the Donation) waits until you want it |

### 6.2 Increments

7 increments that join Waves B–D. Each is sized for one agent session and tested end to end (keyboard, axe, Arabic RTL) like the rest. All data lives in a new `packages/modules/donations`: charity profiles, campaigns (appeals with a goal), giving levels, donations, pledges, pledge payments, paddles, matches and receipts. Every table has fixture rows for both orgs, and every column is declared in `private-columns.ts`. Money uses the existing orders, payments and ledger (M1.5, M1.6) through their exports. Every charge carries an idempotency key; webhooks stay verified and deduplicated.

| Increment | Wave | Scope | Acceptance |
|---|---|---|---|
| **M4.8a** Donations module and giving page | **B** (after Wave A; needs M4.2a co-host roles) | The `donations` module; the Donations tab replaces its placeholder. Campaigns with a goal; giving levels with a name, amount and optional description ("$1,000 funds a classroom"). A public, mobile-first giving page per event: level buttons or an own amount, one-off gifts, cover the processing fee (P4-10), tribute (in honor or in memory, with an optional note to a named recipient), how the donor's name appears (P4-13), employer name (P4-17). Payment is an order with a `donation` item as a direct charge on the connected account with no application fee (P4-9); unconnected orgs see "Connect Stripe to accept gifts" | A gift charges exactly the chosen amount plus the fee cover, on the connected account, with application fee 0; an unconnected org cannot open the page; anonymous gifts never show a name in any public payload (leak crawler) |
| **M4.8b** Charity profile and receipts | **B** | Charity profile (legal name, EIN, exempt status, fiscal sponsor), checked by staff against the IRS exempt-organization list. Fair-market value on ticket types. Receipts by email and PDF in every locale, with the deductible amount (P4-11); the quid-pro-quo notice on ticket pages over $75; plain "not tax-deductible" receipts for unverified orgs; a year-end statement per donor. Receipt text comes from a template marked `legal-copy` | A $500 ticket with a $150 fair-market value gives a receipt with $350 deductible; a $100 gift with nothing in return says "No goods or services were provided"; golden PDFs in English and Arabic |
| **M4.8c** Paddle raise console and spotters | **C** (needs M4.2b guests linked to tickets and tables; **M3.1b** realtime) | Paddle numbers given to guests or parties (bulk by table or at check-in). A host/auctioneer console: arm a level, see the running total and count, close a level, undo. A spotter view on phones: **keyboard-first** (type the paddle number, Enter; big 44 px targets), **offline-tolerant** (entries queued on the device with their own ID and synced exactly once), duplicates flagged for the recorder, never dropped. A recorder review turns recorded paddles into confirmed pledges | 30 spotters recording 400 paddles, half of them offline for 2 minutes, sync with no loss and no duplicates; the keyboard-only path works; a paddle not assigned at this event is refused |
| **M4.8d** Live screen and QR-to-give | **C** (needs **M3.1b**) | A thermometer screen for the room's projectors (goal, total, gifts, level being called, the active match), over the realtime publisher, with a signed display link and a reconnect snapshot. Names only for donors who opted in (P4-13). QR-to-give on the screen and on table cards opens the M4.8a page tied to the paddle-raise campaign, so gifts from phones join the total live. Reduced-motion and high-contrast modes | A gift made on a phone moves the thermometer within 3 s p95; screens never show an unconsented name (fixture with mixed consents) |
| **M4.8e** Cards on file and pledge collection | **D** (needs M4.4b check-in; **M3.2b** alerts; **M3.7a** journeys if merged, otherwise today's reminder planner) | Card saving at ticket checkout and by QR at check-in or on the table (SetupIntent on the connected account, consent recorded; P4-14). One-tap giving from the guest's phone with the saved card. End-of-night pledge summaries, then off-session charges next morning (P4-12). Invoices with pay links and due dates; reminders that stop on payment; one retry on a declined card, then a pay link; offline payments and write-offs with a note; an alert "12 pledges ($18,500) unpaid 14 days after the event" | A confirmed pledge with a saved card is charged once, on schedule, exactly the pledged amount (replayed jobs never charge twice); reminders stop once paid; a pledge without saved consent is never charged |
| **M4.8f** Matching gifts | **D** | Challenge matches: sponsor, window, ratio, cap; matched amounts computed from confirmed gifts and shown on the console and screen; the sponsor's match becomes its own pledge. Employer matching list export (P4-17) | A 1:1 match capped at $25,000 stops at the cap exactly; a refunded gift reduces the match |
| **M4.8g** Reporting, exports and reconciliation | **D** (extends M1.6e reconciliation) | Reports per donor, per level, per source (online, paddle, QR, ticket donation) and per match; pledged vs collected vs written off. CSV and XLSX exports shaped for common donor CRMs (column mapping, anonymous flag kept). Reconciliation of donations to the connected account's balance transactions and payouts, with differences listed like M1.6e | The fixture gala's report totals equal the ledger memo entries and the provider's balance transactions to the cent; exports never include donors of the other org |

The M4.x hardening pass also covers the gala giving journey end to end (ticket with a saved card → check-in → paddle raise → confirmed pledge → charge → receipt → reconciliation), a 1,000-guest gala load test with 30 spotters and 10 screens, and leak-crawler coverage for every donations table.

### 6.3 What waits for you

**Decisions:** P4-9 to P4-17, above. P4-10 (any fee on donations) is yours alone.

**Accounts:**
- Live Stripe, as for tickets. Each charity connects its own Stripe account and applies for Stripe's nonprofit pricing itself.
- A Twilio 10DLC charity campaign, only when you want text-to-give (P4-15).

**Legal** (all `legal-copy`, for your counsel):
- Receipt and acknowledgement wording, the fair-market-value statement and the quid-pro-quo notice (P4-11).
- The card-on-file authorization text and the pledge terms (P4-12, P4-14).
- The donor privacy notice and the consent to the charity's marketing (P4-13).
- An organizer-agreement clause: the organizer states it is a registered charity where it says so, and that **charitable solicitation registration in each state is the organizer's responsibility**, not Yayatoh's.
- State rules to confirm: whether Yayatoh is a "charitable fundraising platform" or "professional fundraiser" anywhere under `organizer_mor` (it should not be, since it never holds the money), and commercial co-venturer rules when a business sponsor promotes a match.
- Counsel's view before donations may ever run under `platform_mor` (P4-9).

**Numbers:**
- Pledge due date and reminder schedule (defaults: 30 days; +7, +21, +28).
- When card-on-file pledges are charged (default: next morning at 9:00, event time).
- How long saved cards are kept (default: 30 days after the event).
- Default giving levels for new galas.
- A fee on donations, if you ever want one (P4-10).

**Real-world exit criterion:** one real gala with a paddle raise run on Yayatoh: levels called from the console, spotters on phones, the thermometer on screen, pledges collected and receipts sent. That needs a willing charity with a connected Stripe account and your counsel's receipt wording.

### 6.4 Timing

The 7 increments run inside Waves B–D in parallel with the rest, so they add about **15–25 agent-hours plus 2–4 hours of merging**, and about **half a week of calendar time** to section 5's estimate (now about 2–3.5 weeks for all of Phase 4). M4.8a and M4.8b can start with Wave B. M4.8c and M4.8d need M3.1b merged. M4.8e needs M3.2b merged and, ideally, M3.7a. Live money and receipts still wait for live Stripe, D3 and counsel.
