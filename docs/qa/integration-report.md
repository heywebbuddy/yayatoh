# Yayatoh QA: integration report (round 4 on top; rounds 3 and 2 below)

## Round 4: final round on `qa-integration`

Tester session `qa-baseline`, 28 October 2026. `qa-integration` = `main` + the latest tips of `claude/batch-1-buying-39fe1a`, `claude/batch-2-setup-59fe0b` and `claude/batch-3-redesign-664a1d` (merged twice: after `fa1b432b` batch 2 was merged again; all merges clean, no conflicts). Not pushed.
Run against a fresh database `yayatoh_qa4` (migrated; `demo-seed`, `demo-media`, `demo-marketing`, and batch 2's `demo-content` run), fake payments and fake human check, **production build** (`next build` with type-check on, then `next start`) on port 3140. The real Anthropic key was loaded for the AI tests (never printed or committed). The staff console (`apps/admin`) was started on port 3141 for the admin-panel tests; the user's staff role was added to my local test owner only in `yayatoh_qa4`.
Screenshots are in `C:\Users\ADMIN\.claude\projects\D--yayatoh-2-0-yayatoh--claude-worktrees-qa-baseline-a94866\8e728a03-1454-42dd-9484-ed2066dd2cef\tool-results\`.

### R4.1 Migrations, type-check and tests

- Journal: 190 entries, no duplicates, every tag has its SQL file, snapshot chain unbroken (0176 to 0190). **Gap: there is no `0189`** (the journal goes 0188 then 0190). `drizzle-kit generate` still says "No schema changes". Harmless, but the numbering is not strictly consecutive. New migrations on top of round 3: 0188 (testimonials), 0190 (platform content). Migrate on a clean database: ok.
- `tsc --noEmit` on `apps/web` (12 GB): **0 errors**. `pnpm typecheck` on all 76 packages: 74 pass in the parallel run; the other two (`automation-apps`, `zapier`) died with a process crash (exit `-1073740791`, memory) and show **0 errors when run alone**. `check:modules`: ok. `next build` with type-check: ok.
- Integration tests of the changed modules (7 files, 21 tests): all pass.
- `pnpm test` (unit): 339 of 357 files pass, 18 files fail. Compared with round 3 (which also had the Windows-only failures: golden CRLF files, `event-routes`/`empty-state-audit` path globbing, `spectral`, `sdk`, vectors, `webhooks/catalog`, `tools/*`), the **new failures** are:
  - **`packages/modules/notifications/tests/render.test.ts`: 430 snapshot failures** (every kind in every locale). Cause: the "greeting without a name" fix changed "Hello," to "Hello!" and the snapshot file was not updated (`Expected "Hello," / Received "Hello!"`). Severity: minor (CI red), easy fix (`vitest -u` after review).
  - **`packages/testing/tests/column-privacy.test.ts` (R1) still fails**, now with `events.speakers.bio (text) is neither private nor public. Add bio: ... in packages/modules/events/src/private-columns.ts`. (`orders.seat_legs` is fixed.) Severity: major for the canary test's purpose.
  - Fixed since round 3: `packages/ui/tests/tokens.test.ts` (R2) passes.
- Running the unit/integration tests again reset the shared Postgres role passwords once (`28P01`); `pnpm db:bootstrap` fixes it.

### R4.2 Real AI (graded)

- **Create with AI** (~12–14 s each):
  - **Wedding** (two-day Goa, 150 guests): type Wedding, good tagline, 2 dates, free guest pass for 150, agenda, 6 sensible FAQs. **A-** (only day 1 in the agenda).
  - **Conference** (two-day Bengaluru, 400): type Conference, three ticket types totalling 400 (early bird / standard / student), agenda, 6 FAQs. **A-** (agenda covers day 1 only, with a "Closing Keynote" on day 1).
  - **Concert** (Pune amphitheatre, 1500 seats): it matched the organization's own "Riverside Amphitheatre" venue, split the 1500 seats between General and VIP, band-by-band agenda, weather/seating FAQs. **A**.
  - **Tour** (Panjim sunset cruise, 40 passengers): type Tour, two ticket types adding up to 40, agenda and FAQs; "daily" was not turned into a repeating schedule and the two hotel pickups appear only in an FAQ (no pickup points proposed). **B+**.
  - Credits: each proposal used one (20 to 16 after four); the page keeps showing the allowance.
- **Drafting panels** on the event content page: **tagline** (4.5 s, good: "Two days in Hyderabad and online for managers and engineers rethinking AI, teams and remote work."), **description** (6 s, good Markdown with the right dates and venue), **FAQ** (7 s, six Q&As, correct but vague on specifics such as the student pass; it prints the time zone as `America/New_York` for a Hyderabad event). Grade **B+ to A-**. There is no separate "agenda" drafting panel: the agenda comes only from Create with AI.
- **Campaign "Draft with AI"** (Campaigns, a draft campaign): the action ran (about 12 s, one credit charged) but **the subject and body fields stayed unchanged** in my run, and a second press did nothing. Not confirmed as a bug (my click may have been a scripted one); needs a recheck by hand. Severity: major if it reproduces.
- **Attendee assistant**: single question ("When does the opening keynote start and who is speaking?") answered correctly with sources (Agenda, Schedule); two-part question ("Where is the venue and what is the refund policy?") answered **both** parts correctly with sources (round 3: only half); an unanswerable one ("free parking and can I bring my dog?") answered "I can't find that in this event's published details" and offered to contact the event team. **A**. Each answer uses a credit.

### R4.3 Public pages, phone width and CSP (production)

- 320 px (so 375 and 414 also fit): no horizontal overflow on home, events, pricing, status, privacy, help, features, contact, blogs, organizer page and its blog, 404 page, sign-in, attendee, solutions, venues, network, and the conference and gala event pages.
- **CSP in production:** a clean browser tab loading the home page (and scrolling it to the bottom) logged **0 console errors**; the other pages (event page, blogs, help, features, contact, events, pricing, weddings) read back with no errors either. Caveat: my first read in a reused tab showed old messages from earlier pages (including inline-style/script violations and a React #412), and could not be attributed, so I repeated it in a new tab and got zero. The earlier 354 in that tab are not reproduced.
- **`/help`, `/features`, `/contact`, `/blogs`** returned 404 until I set `MARKETPLACE_CONTENT_ORG=webbuddy` (outside production they default to an org called `harbor-arts`, which my seed does not create). With it set they load. The footer links to the first three, so any deployment without a content org shows dead links.
- New home sections present: Featured events, event-type rails, Popular organizers, How it works, "Everything you need…", What organizers say, Latest from the blog, Questions answered, Earn more (affiliate teaser), final call to action. Testimonial and blog post created in the admin panel appear on home and on `/blogs`.
- The site switched to Spanish for the rest of one test session after I fetched `/lang/es` as a probe; `/lang/en` switches back (my probe, not a bug).

### R4.4 The client's points, final status

| # | Point | Status | Evidence in round 4 |
|---|---|---|---|
| 1 | Venue description, contact | DONE | Venue page has description, contact email/phone, website. |
| 2 | Add venue from wizard | DONE | Inline "+ Add a new venue" form; choosing a saved venue sets the time zone (Kolkata for Skyline Studio). |
| 3 | Content editing | DONE | Row editors, live preview, toolbar, day headings. |
| 4 | One seat or whole table | DONE | Round 3 table of 10 bought; unchanged. |
| 5 | Checkout | DONE | Free, paid, seated, whole table, three-date seat purchase, tour; "Quick email check" code panel. |
| 6 | DJ, MC, artists, speakers, influencers | DONE | Role list: Keynote speaker, Speaker, Panelist, Moderator, **Host / MC**, DJ, Artist / Performer, Influencer, Special guest; the public page has headings "Hosts", "MCs", "DJs", "Artists", "Performers", "Influencers". (One scripted add saved the wrong role because my click picked another option; role mapping itself not at fault.) |
| 7 | Video background in hero | DONE | Uploaded a WebM with a poster as the hero video: it plays behind the title (`...1793178380824-alspot.jpg`); YouTube embed also in the page. MP4 not tried (no MP4 file available, and no ffmpeg; I generated the WebM in the browser). |
| 8 | Table number on seat map | DONE | Seen in round 3, unchanged. |
| 10 | Video overviews | DONE | Added a "Video" section in the editor with an uploaded WebM + poster; the public page shows it with controls and it is ready to play (`...1793178459446-i9evta.jpg` shows the hero). Minor: the editor's live preview says "Nothing to preview yet" for a video section. |
| 11 | Multi-day, re-entry | DONE | Round 3: re-entry window and next-day check-in; unchanged. |
| 12 | Seat per day/leg | DONE | On "Demo · City Hopper Express" (three Mondays) picked Row B·3 (Nov 16), Row C·5 (Nov 23) and Row A·7 (Nov 30): one order of $120, three tickets, each "Valid on <its date>" with its own seat. |
| 13/35 | Attendee chat | DONE | Lobby chat between two attendees (round 3). |
| 14 | Total before paying | DONE | "Your order … Total to pay … nothing is charged yet". |
| 15 | Landing pages | DONE | `/solutions/*`. |
| 16 | Event creation | DONE | Wizard (required fields marked with *), Create with AI, design options; event type no longer pre-selected. |
| 17 | Frontend | DONE | New design everywhere public; see R4.3. |
| 18 | Sponsor pages | DONE | Round 3. |
| 19 | Keynote speakers etc. | DONE | See 6. |
| 20 | Tour | DONE | Round 3 tour created and bought with a pickup point; round 4 the AI proposes a Tour. |
| 21 | Blog | DONE | Organization blog (round 3), plus round 4: the platform blog from the admin console. |
| 22 | WhatsApp | DONE | Round 3. |
| 23 | Manage users | DONE (not fully) | Invitation sent and email delivered (round 3); accepting it was not tested. |
| 24 | SEO | DONE | Round 3. |
| 25 | AI setup and assistant | PARTIAL | See R4.2: Create with AI A- to A; drafts good; assistant A; **campaign draft did not fill the editor in my run**. |
| 26 | Same ticket twice | DONE | Round 3. |
| 27 | Organizer preview of attendee portal | DONE | A mock with sample data and inactive links (round 3). |
| 28 | Change a seat | DONE | Round 3: swap completed in the UI. |
| 29 | Max attendees | DONE | Event-wide limit field on the tickets page. |
| 30 | Competitors | REF | Summary in round 3. |
| 32 | Ticket content | DONE | Round 3. |
| 33 | Bulk tickets to one person | PARTIAL | Submitted "Who is coming?" with two guests: both emails arrived ("QA Legs Buyer sent you a ticket for …"); the mobile field exists; SMS delivery cannot be tested without Twilio. |
| 34 | Invoice/receipt | DONE | Receipt page and PDF. |
| 36 | Redesign | DONE | Public side; console stays light. |
| 37 | Separate file per ticket | DONE | ZIP, one file per ticket (round 3); the three-leg order also offers it. |

### R4.5 Other things tested

- **Admin panel** (staff console on :3141, sign-in with password + authenticator code): "Site content" has Blog, Testimonials and Home hero tabs. Created and published a blog post ("QA admin post…", "Live at /blogs/qa-admin-post") and a testimonial ("QA Organizer"): both appear on `/blogs` / home within seconds. The organization's own posts and the demo posts show on `/organizers/webbuddy/blogs` and open (HTTP 200).
- **Who is coming?** two guests submitted; emails delivered.
- **Team invitation**: the invite was sent in round 3 and the email arrived; accepting it was not tested.

### R4.6 Bugs and baseline retest

| # | Result |
|---|---|
| B01 time zone | **Fixed** (venue form and wizard). |
| B02 multi-date range | **Fixed** on the order page (each ticket "Valid on <date>"); claim page not rechecked. |
| B05 free button / code panel | Code panel **fixed**; free-ticket button label not rechecked. |
| B09 empty-name greeting | **Fixed** ("Good morning, ratnesh."); the fix left 430 stale snapshot tests (R4.1). |
| B11 net = gross | Still gross = net ($38,125); the backlog says the demo orders carry no fees. |
| B13 AI quality | **Good** with the real key. |
| N1 networking sign-in | **Fixed** (code on the networking page now signs in). |
| N4 404 pages | Load only when a marketplace content org exists (see R4.3); **open as a deployment dependency**. |
| N6 "Valid" after check-in | **Fixed** ("Checked in" on the console order page). |
| R1 column-privacy | **Still failing** (`events.speakers.bio`). |
| R2 tokens test | **Fixed**. |
| R3 hero video | **Fixed** (the uploaded video fills the hero). |
| R4 required Ends field | **Fixed** (fields marked "*"). |

New in round 4: (a) 430 stale render snapshots, (b) `events.speakers.bio` privacy declaration, (c) possible campaign-draft problem, (d) journal skips 0189, (e) live preview of a video section is empty, (f) FAQ/AI drafts print `America/New_York` for non-US events.

### R4.7 Not covered

Accepting the team invitation; an MP4 upload (only WebM, generated in the browser); SMS delivery; the campaign AI draft with a trusted click; next-day claim-page date; the console in a light/dark review; token-only public pages. A Docker outage (engine returning HTTP 500, then restored by the lead) interrupted the round for a while; nothing was lost.

---

# Round 3 (history)

## Round 3: latest tips of all three batches on `qa-integration`

Tester session `qa-baseline`. Branch `qa-integration` now has the latest tips of `claude/batch-1-buying-39fe1a`, `claude/batch-2-setup-59fe0b` and `claude/batch-3-redesign-664a1d` merged (only conflict: `pnpm-lock.yaml`, regenerated with `pnpm install`). Not pushed.
Run on port 3140 against a fresh database `yayatoh_qa3` (migrated, `demo-seed.ts` + `demo-media.ts`, worker running, `HUMAN_CHECK_PROVIDER=fake`, `PAYMENTS_PROVIDER=fake`), served from a **production build** (`next build` with type-check on, then `next start`). Screenshots are in `C:\Users\ADMIN\.claude\projects\D--yayatoh-2-0-yayatoh--claude-worktrees-qa-baseline-a94866\8e728a03-1454-42dd-9484-ed2066dd2cef\tool-results\` (file names given); much of the checking was by reading the DOM, so not every line has an image.

### R3.1 Migrations and snapshots

- Journal: 188 entries, idx 0–187, sequential, no duplicate numbers; every journal tag has a SQL file and the reverse. Batch 1's hand-written `0186_event_limit_and_offer_phone.sql` (adds `ticket_transfers.to_phone`; creates `ticketing.event_limits` with RLS, FORCE RLS, policy, indexes and a check) and `0187_order_seat_legs.sql` (`orders.seat_legs jsonb`) read correctly and migrate cleanly on a new database.
- `drizzle-kit generate` refused with a "snapshot collision" because snapshots 0176, 0177 and 0183 had the same parent. Fixed (committed `e3388e65`): every snapshot 0176–0187 now points to the previous one, and `0187_snapshot.json` is the full current schema, generated by drizzle-kit from the merged schema. `drizzle-kit generate` now says "No schema changes, nothing to migrate". I checked the final database constraints (`assets_slot_check`, `assets_owner_slot_check`, `event_sections_kind_check`, `assets_org_single_slot_key`) against the schema and they match, so no migration is missing: the intermediate snapshots were just incomplete.

### R3.2 Checks

| Check | Result |
|---|---|
| `pnpm install` | ok |
| `tsc --noEmit` on `apps/web` (12 GB) | **0 errors** |
| `pnpm typecheck`, all 76 packages (concurrency 2, 12 GB) | **76 of 76 pass** |
| `pnpm check:modules` | ok |
| `next build` (type-check on, 12 GB) | ok |
| Integration tests of the changed modules (`assign-holders`, `event-limit`, `lobby`, `move-ticket-seat`, `reentry`, `seat-legs`) | **6 files, 17 tests pass** |
| `pnpm test` (unit) | 339 of 357 files pass; **57 tests in 18 files fail** (below) |

Unit failures I can attribute to the merge (real):
- `packages/testing/tests/column-privacy.test.ts` (3 tests): `orders.orders.seat_legs (jsonb) is neither private nor public. Add seat_legs: ... in packages/modules/orders/src/private-columns.ts`. Batch 1 did not declare the privacy class of the new column. **Severity: major** (this canary test exists to stop an undeclared personal column shipping).
- `packages/ui/tests/tokens.test.ts` (2 tests): "declares every light/system (dark) colour, gradient and elevation with the same value": `tokens.ts` and `styles.css` disagree after batch 3's dark tokens. Severity minor.

Unit failures that look environmental (Windows) and that I did not compare with a clean `main`: the `golden.test.ts` files of seating, badges, donations and media (expected HTML has CRLF, got LF); `apps/web/tests/event-routes.test.ts` and `empty-state-audit.test.ts` ("found 2 event pages, expected more than 40", path-separator globbing); `apps/api/tests/spectral.test.ts`; `packages/sdk` (2 files); `packages/checkin-engine` and `packages/ticket-crypto` vectors; `packages/modules/webhooks/tests/catalog.test.ts`; `apps/admin/tests/staff-mail.test.ts`; four `tools/*` test files. The notifications snapshot file was also rewritten by the run (reverted, not committed).

Environment side effect: after running the integration tests, `app_user`'s database password was wrong again (`28P01`) for every database on the shared server; `pnpm db:bootstrap` fixes it. The tests (or the bootstrap they call) seem to reset shared role passwords.

### R3.3 Public pages: phone width and CSP (production build)

- **Overflow.** At 320 px (stricter than 375 and 414, so those pass too) there is no horizontal scroll on `/`, `/events`, `/pricing`, `/organizers/webbuddy`, `/attendee`, `/sign-in`, `/sign-up`, `/venues`, `/venues/<slug>`, `/series`, `/solutions/{weddings,organizations,galas,conferences}`, `/status`, `/privacy`, the conference and gala event pages, `/events/<slug>/network` and `/organizers/webbuddy/blogs`. **P1/N2 is fixed.** Not measured this round: token-only pages and the speaker/sponsor/exhibitor detail pages (fine at 375 in round 2).
- **CSP in production: 0 CSP console errors on `/` and 0 on the conference event page** (round 2: at least 186 on the home page). **N3 fixed** (batch 3 replaced script-written styles with a CSS scroll-driven animation).
- Still 404: `/features`, `/help`, `/contact`, `/blogs`, `/search`, `/t/webbuddy`, `/pages/x` (**N4 open**, minor). `/events/<slug>/network/lobby` is now 200 (was 404).

### R3.4 Client points, final status

D = DONE, P = PARTIAL, N = NOT DONE. "Evidence" is what I did in the app.

| # | Point | Status | Evidence | Open issues |
|---|---|---|---|---|
| 1 | Venue description, contact | D | Venue page has description, contact email/phone, website, address; created "QA2 Hall". | |
| 2 | Add venue from wizard | D | Guided step 2 "+ Add a new venue" opens an inline form (name, address, city, country, time zone, capacity, contact, website, "Save and select venue"). `mcp-Claude_Browser-blob-1793105113596-tq71is.jpg` | Event time zone is still not taken from the saved venue (B01). |
| 3 | Event page content editing | D | Structured section editors (time pickers, rows, day headings, reorder, live preview, announcements). `...1793105151479-3beo2l.jpg` | |
| 4 | One seat or whole table | D | "Select whole table" button; bought a whole table of 10 ($5,000) end to end; single seats too. `...1793104956195-g5bbam.jpg` | |
| 5 | Checkout end to end | D | Free, paid, seated, whole table, multi-date, and a **tour with a pickup point** complete, with order page, receipt, per-ticket PDFs and ZIP. | |
| 6 | DJ, MC, artists, speakers, influencers | P | Roles: keynote, speaker, panelist, moderator, host, dj, artist, influencer, special guest. Checked from the form and role list; did not add one. | No role called "MC" (host or moderator). Minor. |
| 7 | Video background in hero | P | Hero layout "Video background" + YouTube link saves; the page now has the `youtube-nocookie` iframe in the DOM (round 2: missing). | The iframe measured 0 × 0 px inside a 0 px wide parent in this browser, so I could not see it play (sandbox, no internet or reduced-motion handling are possible causes). Needs a look in a normal browser. |
| 8 | Table number on seat map | D | Numbers drawn on each table; batch 3 gave the map a dark palette. | |
| 10 | Video overviews on the event page | P | A `video` section kind exists and CSP allows YouTube/Vimeo; I did not add one through the section editor. | |
| 11 | Multi-day tickets; re-entry reset after X hours | D/P | Re-entry window (1–72 h) saved and tested: a rescan inside the window is "Already checked in", after it "Welcome in". **Next-day check-in tested**: scan, move the admission to yesterday in the database, scan again, "Welcome in". A single ticket valid for several days was not tested. | |
| 12 | Different seat per day/leg | P | New page `/events/<slug>/legs` ("Choose a seat on each date") and migration 0187; for the demo workshop it says "needs at least two upcoming dates that each have their own seat map". Integration test passes. **I could not set up two dates with their own seat maps in the UI** (the console hides Seating for the "Other" profile; the gala has one chart), so the buyer flow was not exercised. | Retest on a seated event with two dates and a chart each. |
| 13/35 | Attendee-to-attendee chat | D | **Lobby chat works**: attendee 1 posted, attendee 2 (separate sign-in) saw it and replied, both messages visible. 1:1 chat still needs a connection first (by design). | The networking page's own email-code sign-in does nothing (N1). |
| 14 | Order total before checkout, no forced sign-in | D | "Your order … Total to pay … nothing is charged yet"; "No account needed". | |
| 15 | Landing pages | D | `/solutions/{organizations,weddings,galas,conferences}` in the new design, fit at 320 px. | |
| 16 | Event creation intuitive, more design options | D | Wizard, Create with AI, per-event design (theme, heading font, hero layout). The event type is **no longer pre-selected**. | |
| 17 | Basic frontend, missing features | D | See 7 and 12 for the remaining gaps. | |
| 18 | Sponsor detail pages | D | Form: tier, descriptions, contact email/phone, video, team, logo; the public page shows brochures; tiers decide which sponsors get a page. | |
| 19 | Keynote speakers, artists, public figures | D | See 6. | |
| 20 | Bus or boat tour | D | **Created "QA Sunset Boat Tour"** (type Tour, pickup point "Panjim Jetty" 30 min before, ticket type, published) and bought 2 seats at checkout choosing the pickup point; the order page shows "Your pickup point: Panjim Jetty, Jetty Road, Panaji. Be here 30 minutes before departure." | The Ends date field is required and must be typed. |
| 21 | Blog posts | D | **Wrote and published a post** with Markdown; it is listed on `/organizers/webbuddy/blogs` and its page renders bold text and lists. | Global `/blogs` 404. |
| 22 | Share via WhatsApp | D | "Share on WhatsApp" on event pages and on the order's send-tickets form. | |
| 23 | Manage users | D | **Invited `qa.teammate@example.com`** as Manager: "Invitation sent." and the invitation email was delivered by the worker. Accepting it was not tested. | |
| 24 | On-page SEO | D | SEO title, description, slug, preview, social image. | |
| 25 | AI event setup and assistant | P | No API key, so only the built-in fallback ran. "Create with AI" for "two-day wedding in Goa, 150 guests…" now gives 2 days, Goa, 150 guests, an agenda and tickets (round 2: wrong type and a single 3 h date). The attendee assistant answers from the event's own details with a source (asked about refunds: correct, "Source: Refund policy"). | Asked "where is the venue and what is the refund policy": only the refund part was answered. The title still copies the prompt. Real AI output untested. |
| 26 | Same ticket twice | D | Same-day second scan: "Already checked in at …". Next day: admitted (see 11). | |
| 27 | Organizer access to attendee portal | D | "Preview attendee portal" opens `/o/.../attendee-preview`: a sample attendee with Overview, My events, Tickets & orders, My schedule and Networking tabs; links are inactive. | It is a mock, so chat cannot be tried from it. |
| 28 | Change an individual seat | D | **Completed a swap**: Seating, Assign guests, "Change seat" on a ticket, picked a taken seat: "swapped seats with another ticket holder. Both tickets stay valid." I meant to pick a free seat; the list moved under my click. The free-seat move is covered only by the passing integration test. | |
| 29 | Max attendees | D | Tickets page has "Event-wide attendee limit … Checkout and the box office both stop selling when it is reached" with "52 tickets sold or held"; integration test passes. I did not set a limit and exceed it in the UI. | |
| 30 | Competitor features (summary) | – | Covered now: branded event sites, agenda/speakers/sponsors/exhibitors, networking, lobby and meetings, check-in with re-entry and fraud signals, seating with whole-table sales and per-ticket moves, receipts, per-ticket PDFs and ZIP, bulk send by email/SMS/WhatsApp, event-wide cap, AI drafting and assistant. Gaps: per-leg seats unproven (12), no "MC" role, real AI untested, `/help`, `/features`, `/contact` 404. | |
| 32 | Ticket content | D | Cards show date/time, seat, holder, "Purchased by"; PDF carries holder, purchaser, group, table. | |
| 33 | Bulk tickets to one end user | D | "Who is coming? Send everyone their ticket": name, email and **mobile number to text the link** per ticket, plus copy link and WhatsApp. Not submitted. | |
| 34 | Invoice / receipt | D | Order page "View receipt" and "Download receipt (PDF)". | |
| 36 | Overall redesign | D | Public site, sign-in/up, event pages. The console stays light (out of scope). | |
| 37 | Bulk download gives separate files | D | **ZIP tested**: "Download all tickets (ZIP, one file each)" returned `tickets.zip` (application/zip, 2 entries for 2 tickets); "or as one PDF" remains. | |

### R3.5 Open bugs retested

| # | Result |
|---|---|
| B01 venue time zone | **Venue form fixed** (choosing India sets Asia/Kolkata). **Event wizard still open**: picking saved venue "Skyline Studio, New Delhi" leaves the event on New York. Major → minor. |
| B02 multi-date shows series range | NOT RETESTED (no new multi-date purchase; batch 1 commit says fixed). |
| B05 free button label / code panel | NOT RETESTED (could not pick a free quantity by script; batch 1 commit says fixed). |
| B06 wrong copy on the code step | **Fixed**: now "Enter it to sign in." |
| B08 "find your seat" on unseated tickets | **Fixed**: tour tickets say "At the event: ask for help". |
| B09 empty-name greeting | **Open**: console "Good morning, ." and emails "Hello,". |
| B10 2FA status "Off" | **Fixed** (shows On). |
| B11 net equals gross | **Open**: Gross $39,350.00, Net $39,350.00 "after refunds and platform fees". Needs a product answer. |
| B12 blank event cards | **Fixed**: cards show covers; events without one get a generated cover (`...1793111400032-2hp7mu.jpg`). |
| B13 AI draft quality | **Improved**, still open without a key (see 25). |
| B14 event type default | **Fixed**. |
| N1 networking-page code sign-in | **Open, major**: on `/events/<slug>/network` the code form leaves the page on "Confirm your email" and does not sign in; signing in on `/attendee` first makes the networking page work. |
| N2 phone overflow | **Fixed** (R3.3). |
| N3 CSP noise | **Fixed** (0 in production). |
| N4 404 pages | **Open**, minor. |
| N5 assistant gives no answer | **Fixed**. |
| N6 console order shows "Valid" after check-in | Not checked on the order page this round (batch 1 commit says fixed). |
| N7 white seat map on dark page | **Fixed**. |
| N8 `MISSING_MESSAGE branding` | **Fixed** (not in this run's server log). |

### R3.6 New findings this round

- **R1 (major)** `column-privacy` unit test fails: `orders.orders.seat_legs` is not declared in `private-columns.ts`.
- **R2 (minor)** `tokens.test.ts` fails after the dark-token change.
- **R3 (minor)** Hero video iframe is 0 × 0 px in my run (point 7).
- **R4 (minor)** The event form's required Ends field gives no hint before submit (browser tooltip only) and the date picker needs the end time typed.
- **R5 (minor, environment)** Running the integration tests resets shared Postgres role passwords.
- **R6 (cosmetic)** The assistant answers only part of a two-part question.

### R3.7 Not covered

A seat per leg on a multi-date seated event; moving a ticket to a free seat through the UI; real AI (no key); the hero video playing; B02 and B05 buyer flows; submitting the "Who is coming?" form; accepting the team invitation; the global `/help`, `/features`, `/contact` pages.

---

## Round 2 (history): integration of the three batches

Tester session `qa-baseline`. Branch `qa-integration` = `main` + `claude/batch-1-buying-39fe1a` + `claude/batch-2-setup-59fe0b` + `claude/batch-3-redesign-664a1d` (in that order, merge commits, not pushed).
Run on port 3140 against a fresh database `yayatoh_qa2` (migrated, `demo-seed.ts` + `demo-media.ts` with `D:\yayatoh_2.0\demo-images\web`, worker running, fake payments, fake human check). Browser: built-in pane, desktop and 375 px. No Anthropic key was configured, so AI output is the built-in fallback.

Screenshots are in `C:\Users\ADMIN\.claude\projects\D--yayatoh-2-0-yayatoh--claude-worktrees-qa-baseline-a94866\8e728a03-1454-42dd-9484-ed2066dd2cef\tool-results\` (file names below); many checks were made by reading the DOM and have no image.

## 1. Merge notes (what I resolved)

- `apps/web/messages/*.json` (13 locales): union of all keys, by a three-way JSON merge (a key removed on only one side stays removed). Each locale file ended up with 289 top-level namespaces.
- Migrations: batch 1 keeps `0176`; batch 2's six migrations renumbered `0177`–`0182`; batch 3's three renumbered `0183`–`0185`. Journal is sequential (idx 0–185) and SQL files and snapshots were renamed to match. `pnpm db:migrate` ran clean on a new database. (Snapshots from the batches were each generated from a different parent, so the next `drizzle-kit generate` will diff against batch 3's snapshot: regenerate or hand-fix one snapshot.)
- Source conflicts: `apps/web/src/proxy.ts` (kept both frame-source lists: console video + hero video), `orders/[token]/page.tsx` (both imports: name-holders form and pickup info), `events/src/schema.ts` and `private-columns.ts` (all columns and checks: seo_*, show_attendee_count, design).
- Test fix (committed): `packages/modules/events/tests/content.test.ts` wanted `day` on schedule rows after batch 2; one-line change.
- `pnpm install` ok. `pnpm check:modules`: ok.

### Type errors after merge

`tsc --noEmit` on `apps/web` for `qa-integration` with `--max-old-space-size=12288`: **exit 0, no errors** (empty output). The earlier failures were out-of-memory crashes, not type errors: `next build` crashed at "Running TypeScript" with a V8 heap error at 7 GB, and `pnpm typecheck --continue` showed many packages "failed" because turbo runs tsc in parallel and ran out of heap. After the test fix, the only real type error in the whole workspace was the `content.test.ts` one above (events package). `next build` with the type-check step skipped built fine; the skip was a temporary local edit of `apps/web/next.config.ts`, reverted, not committed.

## 2. Public routes (item 3)

53 route patterns under `[locale]` excluding `/o/` and admin; ~150 files in total, most are token pages that need a live link (RSVP, hub, survey, display, claim, etc.). I fetched 52 resolvable URLs and looked at screenshots of the main ones; 375 px checked with `scrollWidth`.

All use the NEW (dark "showcase") design: home, /events, /solutions/{organizations,weddings,galas,conferences}, /pricing, /venues(+detail), /series(+detail), /organizers/webbuddy(+blogs), /status, /my-tickets, /attendee, /sign-in, /sign-up, event pages and sub-pages (speakers, sponsors, exhibitors, network, live), legal pages, /privacy. Examples: `mcp-Claude_Browser-blob-1793104853420-uj0ojx.jpg` (home), `...-hkiq4s.jpg` (event page), `...-scnsby.jpg` (sign-in), `...-uz2xz8.jpg` (sponsor), `...-1yuwsl.jpg` (speaker), `...-d7f4g4.jpg` (network), `...-z0q2ub.jpg` (legal).
BROKEN (404): `/features`, `/help`, `/contact`, `/blogs`, `/search`, `/t/webbuddy`, `/pages/x`. `/features`, `/help`, `/contact` are routes in the source tree but 404 here (help centre / pages empty or switched off in the demo data); `/blogs` (global) 404 while the organizer blog works. Not checked: the token pages and `/dev/*`.
OLD DESIGN: none seen on public pages. The organizer console and the `/checkout/fake` page keep the old light look (not in scope).

Phone width (375 px):
- **P1 (major)** Home, /pricing, /organizers/webbuddy and /attendee overflow horizontally: page is 417 px wide at a 375 px viewport. The top bar's right group (search, Sign in, Sign up, menu button) is wider than the screen, so the hamburger sits off screen (`mcp-Claude_Browser-blob-1793104883110-biw6pz.jpg`). Steps: open `/` at 375 px. Expected: no horizontal scroll, menu reachable. Actual: scrollWidth 417, menu button right edge at 417.
- /events, /solutions/weddings, event pages, /sign-in, /venues, /network, sponsor page: fit.

Console errors:
- Dev server: 465 CSP "style-src" inline-style violations on the event page.
- **Production build** (`next build` + `next start`): home page logs at least 186 "Applying inline style violates ... style-src 'self' 'nonce-…'" errors (the reader returned its 200-message cap; all CSP ones were `style-src`, none for script/frame/img). Event page: not counted cleanly (the console buffer was polluted by earlier dev-server HMR noise); a sample after loading it showed only the old HMR websocket errors. Likely cause: JS-set inline styles (framer-motion parallax / the equalizer hero) under a nonce-only `style-src`. Severity minor (visual effects may be dropped), but the count is high.
- Hero video (item 7): the event page HTML contains the `youtube-nocookie.com/embed/…` URL and a "Pause background video" button, but no `<iframe>` was present in the DOM (dev or prod) in this sandbox, so I could not confirm the video actually plays. Needs a retest on a machine with internet.
- Server log: `MISSING_MESSAGE: Could not resolve 'branding' in messages for locale 'en'` (3x) while using the console. Cosmetic/log noise; `branding` namespace is missing on `main` too.

## 3. Client points

Status / how verified / evidence.

1. **Venue description and contact (email, phone): DONE.** Venue page has description, contact email, contact phone, website, address, accessibility. Created "QA2 Hall" and saw the fields.
2. **Add a new venue from the wizard: DONE.** Guided step 2 has "Saved venue" and a "+ Add a new venue" inline form (name, street, city, country, time zone, capacity, contact email/phone, website, "Save and select venue"). I opened it; I did not submit it. `mcp-Claude_Browser-blob-1793105109507-rror67.jpg`.
3. **Event content editing too basic: DONE.** Content page has structured editors per section (time pickers, rows, day headings, move up/down, Markdown toolbar, live preview, announcements). `mcp-Claude_Browser-blob-1793105151479-3beo2l.jpg`.
4. **One seat or the whole table: DONE.** "Select whole table (N seats)" per table; bought a whole table of 10 ($5,000) end to end; single seats still selectable. `mcp-Claude_Browser-blob-1793104956195-g5bbam.jpg`.
5. **Checkout end to end: DONE.** Free (baseline), paid, seated, whole-table and multi-date (baseline) all complete; order page, receipt, PDF. Live order summary and "Total to pay … nothing is charged yet" shown before the button. (Not retested after the merge: the free-ticket flow and the $0 button label.)
6. **DJ, MC, artists, speakers, influencers: PARTIAL.** Speaker role list: keynote, speaker, panelist, moderator, host, dj, artist, influencer, special guest; public page groups by role. No role literally called "MC" (host/moderator presumably). Verified from the form and the role source, not by adding one.
7. **Video background in hero: PARTIAL.** Event "Page design" has Hero layout "Video background" + YouTube/Vimeo link; saved it and the page then has the embed URL and a pause button, but no iframe appeared (see section 2).
8. **Table number on the customer seat map: DONE.** Numbers inside the tables on the map, whole-table button, no "Table Table 1".
10. **Video overviews on the event page: PARTIAL.** `video` section kind exists in the section model and CSP allows YouTube/Vimeo for public and console; not exercised in the UI.
11. **Multi-day tickets; re-entry reset after X hours: PARTIAL/DONE.** Re-entry setting ("scan again N hours after the last entry", 1–72 h, off by default) works: set 1 h, backdated the admission 2 h, rescan = "Welcome in". Multi-date events and the multi-day schedule exist (baseline multi-date purchase works). A single ticket valid for several days was not tested.
12. **Different seat per day/leg: NOT DONE** (not found). Seating is one seat per ticket; nothing per day.
13. **Attendee chat: PARTIAL.** Networking people list, profiles, chats page exist; 1:1 chat is only allowed after a connection or an agreed meeting, so I did not send a message. Event lobby `/network/lobby` returns 404.
14. **Order total before checkout; no forced sign-in: DONE.** "Your order … Total to pay … This is the final price" and "No account needed. We may email you a 6-digit code".
15. **Landing pages (organizations, weddings, galas, conferences): DONE.** `/solutions/{organizations,weddings,galas,conferences}` render in the new design with demo events.
16. **Event creation more intuitive, more design options: DONE.** Guided 3-step wizard, "Create with AI", and per-event design (theme classic/dark, heading font, hero layout).
17. **Frontend basic / missing features: DONE** (judgement): public site is redesigned; remaining gaps are items 12, 29 and the phone overflow.
18. **Sponsor detail pages: DONE.** Sponsor form: tier, description, longer description, contact email/phone, video, team, logo; public sponsor page also shows brochures; only package tiers that "get a page" link to it. The seeded sponsor page (`...-uz2xz8.jpg`) is bare (logo, tier, one line, website) because the demo data has no contact/video/team.
19. **Keynote speakers, artists, public figures: DONE** (see 6).
20. **Simple bus or boat tour event: PARTIAL.** "Tour" event type with pickup points chosen at checkout exists (event type list: Conference, Gala, Concert, Wedding, Community, Tour, Agency, Event). I did not create or buy one.
21. **Blog posts on the website: DONE.** Console "Pages & blog" lists posts and public `/organizers/webbuddy/blogs` renders; I did not write a new post. Global `/blogs` 404s.
22. **Share tickets via WhatsApp: DONE.** "Share on WhatsApp" on the event page header and on the order page's send-tickets form.
23. **Manage users: DONE (not exercised).** Console Team page has invite and role.
24. **On-page SEO: DONE.** Event Details has SEO title (70), meta description (200), URL slug with redirect, search-result preview, social share image, custom short link.
25. **AI event setup and event chat assistant: PARTIAL.** "Create with AI" returns a draft (fallback without a key): the proposal for "two-day wedding in Goa" was type "Event", a single 3-hour date, copy of the prompt as description, generic tickets (poor). Attendee assistant ("Ask about this event") appears on the public page after enabling it in Branding; pressing Ask produced no visible answer and no server request in the log. Needs a retest with `ANTHROPIC_API_KEY`.
26. **Check in with the same ticket twice: DONE.** Same-day second scan: "Already checked in … at 8:49 AM". Next-day not tested. Note: the order page in the console still lists the ticket as "Valid".
27. **Organizer access to attendee portal; chat/networking: PARTIAL.** Event Details has "Preview attendee portal"; I tested networking as an attendee, not through the organizer preview.
28. **Change an individual user's table/seat: DONE (not submitted).** Seating, "Assign guests": every seated ticket has "Change seat"; drag and drop and swap are described. I did not complete a move.
29. **Max attendees per event: PARTIAL.** Limits exist per ticket type ("Quantity available"), per date ("Capacity") and per registration type; no single event-wide maximum.
30. **Competitor features (Cvent/RainFocus), summary:** the build now covers branded event sites, agenda with speakers, sponsor/exhibitor pages, networking and meeting booking, check-in with fraud signals, seating with whole-table sales, receipts/PDF tickets and AI drafting. Not seen: per-day seat choice (12), event-wide attendee cap (29), a working lobby, live-stream embed proof, and an organizer-facing virtual-booth demo.
32. **Ticket shows date, time, owner, purchaser, ticket type, group label: DONE.** Order cards show date/time, seat, holder, "Purchased by"; PDF source carries holder, purchaser, group, table.
33. **Bulk tickets to one buyer who distributes: PARTIAL.** Order page has "Who is coming? Send everyone their ticket": names/emails per ticket, copy link, WhatsApp. No SMS option. Not submitted.
34. **End user sees and downloads their invoice: DONE.** Order page "View receipt" (R-8831C4C2) with "Download receipt (PDF)". A separate business invoice route exists (`/events/[slug]/invoice/[token]`), not tested.
35. **Event-goers chat with each other: PARTIAL** (same as 13).
36. **Overall redesign: DONE** on public pages; PARTIAL on phone (P1) and CSP noise.
37. **Bulk download gives separate files per ticket: PARTIAL.** Each ticket has its own "Download this ticket (PDF)". The bulk "Download tickets (PDF)" is still one combined `tickets.pdf` (10 pages for 10 tickets); there is no zip or per-ticket-file bulk download.

## 4. Baseline bugs retested

| # | Result |
|---|--------|
| B01 venue time zone ignores country | **OPEN.** New venue (country India) still saved as New York; wizard venue pick (New Delhi) keeps New York; event pages still say "Times are in America/New York." |
| B02 multi-date shows series range | NOT RETESTED (needs a new multi-date purchase). |
| B03 transfer not reachable from order page | PARTIAL: order page now has "Who is coming? Send everyone their ticket" (send/copy/WhatsApp); the one-ticket transfer form was not re-checked. |
| B04 sign-in did not move on | **FIXED** in this run (password then 2FA code goes to the console). |
| B05 free button says "Continue to payment" | NOT RETESTED (could not select a free quantity by script). Button still reads "Continue to payment" before choosing tickets. |
| B06 wrong copy on the code step | **OPEN.** Networking sign-in still says "Enter it to place your order." |
| B07 "Table Table 1" | **FIXED.** |
| B08 "find your seat" on non-seated tickets | NOT RETESTED. |
| B09 empty-name greeting | NOT RETESTED. |
| B10 security page "Off" after enabling 2FA | **OPEN.** Still reads "Authenticator app — Off". |
| B11 net revenue equals gross | NOT RETESTED. |
| B12 blank event card images | NOT RETESTED (images now seeded). |
| B13 AI draft boilerplate | **OPEN** without an API key; fallback output remains generic (and for Create with AI, poor). |
| B14 event type defaults to the org profile | **OPEN.** Still "Agency". |

## 5. New failures found in this round

- **N1 (major)** Networking page sign-in does nothing. `/events/<slug>/network` asks for the email, sends a code, but entering the code (or opening the emailed link) leaves the page on "Confirm your email" with no error. The same code on `/attendee` signs in at once, after which the network page works. Steps: sign out, open `/events/demo-conference-future-of-work/network`, enter `kartik+fow2@webbuddy.agency`, take the code from the mailbox, press "Sign in". Expected: signed in. Actual: nothing, no message.
- **N2 (major)** Phone overflow on pages with the new top bar (P1).
- **N3 (minor)** 186+ CSP inline-style violations on the production home page.
- **N4 (minor)** `/blogs`, `/help`, `/features`, `/contact` return 404.
- **N5 (minor)** Attendee assistant: Ask gives no answer or error (no key; needs retest).
- **N6 (minor)** Console order page still says "Valid" for a ticket that was checked in.
- **N7 (cosmetic)** Seat map stays a white panel inside the dark page.
- **N8 (cosmetic)** Server log `MISSING_MESSAGE: branding`.

## 6. Not covered

Anything needing a real Anthropic key or internet (AI quality, hero video playing); next-day check-in; creating a tour, blog post or team invite; completing a seat move; B02/B05/B08/B09/B11/B12; token-only public pages (RSVP, survey, display, hub, etc.).

## 7. Environment notes

Same shared-Postgres role-password clash as in the baseline report (re-run `pnpm db:bootstrap` if `app_user` password auth fails). Dev mail goes to a file mailbox (`DEV_MAILBOX_DIR`), not Mailpit. Machine runs out of heap on parallel `tsc`; use one at a time with `--max-old-space-size`. Owner 2FA secret for `yayatoh_qa2`: `%TEMP%\qa2-owner-totp-secret.txt`. Production server for this branch may still be running on 3140.
