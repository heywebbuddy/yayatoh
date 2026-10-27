# Yayatoh QA round 2: integration of the three batches (branch `qa-integration`)

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
