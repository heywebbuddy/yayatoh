# Yayatoh QA: second client feedback (R2), branch `qa-r2`

## R2 recheck (after the fixes)

Merged the latest tips of `claude/batch-3-redesign-664a1d`, `claude/batch-2-setup-59fe0b` and `claude/bold-aryabhata-b8c8f1` into `qa-r2` (all clean). Journal: 195 entries (`0195_page_locales` is new), no duplicates, only the old 0189 gap; `drizzle-kit generate`: "No schema changes". Database `yayatoh_qa5` migrated; production build (type-check on) on port 3140; staff console in dev mode on 3141. No integration tests were run.

### Checks

- `pnpm check:modules`: **ok** (was 7 violations). `tsc --noEmit` on `apps/web` (12 GB): **0 errors**. `next build`: ok.
- `pnpm test`: 345 of 362 files pass, 53 tests fail, **all the known Windows-only ones** (golden CRLF, event-routes/empty-state globbing, spectral, sdk, vectors, webhooks catalog, staff-mail, tools/*). `column-privacy` and the `check-modules` test now pass. No new failures.

### The ten bugs

| # | Result | How I checked |
|---|---|---|
| B1 floating bar covers content | **Fixed** | On the gala page the bar fades out (opacity 0) while the passes are on screen; the $500 price and seat list are clear (`...1793485709867-p6j6sb.jpg`). |
| B2 wedding says Get tickets and RSVP | **Fixed** | All three buttons (top bar, hero, bar) say RSVP. |
| B3 paid sign-up fails silently with billing off | **Fixed** | With `BILLING_ENABLED` unset and plans off, `/signup` says the paid plans are "coming soon. You can start on the Free plan now, or talk to our sales team." |
| B4 plans "Not on sale yet", no way to change it | **Fixed** | Admin "Plans & billing" now has a **Put on sale** button per plan; I put four on sale from the admin and `/signup` showed prices. |
| B5 unknown plan in the link falls back to Free | **Fixed** | `/signup?plan=tier_starter` selects Starter. |
| B6 no note about two-step verification / plan page | **Fixed** | After payment a **welcome page** ("Payment received", "Welcome, QA Paid Org Three", "Next step: secure your account with two-step verification, then you are in", button "Set up two-step verification"). |
| B7 pale page titles | **Fixed** | "VENUE DIRECTORY" is solid in light and dark (`...1793485925133-20cir1.jpg`). |
| B8 tour at the wrong venue | **Not verified** | The seed now starts the tour at Charminar Heritage Plaza, but my database already had the old event (the seed skips existing events), which still shows Tech Park Convention Centre. Needs a fresh seed. |
| B9 privacy "Last updated" | **Fixed** | A new version (3) shows "Last updated October 31, 2026 · version 3"; the editor now has locale and effective date fields (per-language pages). |
| B10 admin shows a raw user id | **Partly fixed** | No id any more, but the "Sent by" and version-history editor fields are now **blank** for my staff user (no display name); fall back to the email. Cosmetic. |
| B11 check:modules / venue_type privacy | **Fixed** | See Checks. |

### Paid sign-up end to end (fresh user)

`/sign-up` with the email code, organization form, "Continue to payment" ($29.00 due today), fake checkout, **Pay (test)**, then the welcome page; `billing.org_plans` shows the new organization on `tier_starter`. (Decline and retry were already verified in the first pass.)

### Messaging (conference demo event)

- **Lobby**: posted as an attendee; the message is saved.
- **1:1 chat after connecting**: the demo attendee is connected to Kabir Haddad; a message sent from the chat page is saved and shown. The status line stays on "Connecting…" (the live connection does not come up in this environment, but the message still arrives after the page refreshes).
- **Organizer announcement**: created in the organizer content page; it shows on the public event page.
- **Booth chat**: **not working in my run.** On the Kite Robotics booth chat page (booth chat is switched on for two demo booths) I sent messages three times (Send button, Enter key); no message appeared after reload and no row was written to `engagement.chat_messages`, and no error is shown. Severity: major until explained (it may need a booth operator or the realtime connection, but a silent drop is a bug either way).

### Verdict

**Ready to merge to `main` apart from the booth chat finding and B8's verification.** Merge hygiene is good (check:modules, tsc, build and tests clean; migrations in order; generate clean). Before merging: (1) look at booth chat (confirm whether it needs a staff reply or a realtime backend, and show an error if a message cannot be sent); (2) re-seed once to confirm the tour venue. Deployment notes carry over from the first pass: self-service sign-up needs `BILLING_ENABLED=1` and the plans put on sale in the admin; the live deployment's content org and the "Connecting…" realtime status should be checked there.

---

# First pass (history)

Tester session `qa-baseline`. `qa-r2` is a new local branch from `main` (`a70fdfcc`) with these merged in order: `claude/batch-3-redesign-664a1d` (R2-A), `claude/batch-2-setup-59fe0b` (R2-B), `claude/bold-aryabhata-b8c8f1` (R2-C). Not pushed.
Run against a fresh database `yayatoh_qa5` (demo-seed, demo-media, demo-content, the worker's demo-platform-content, catalog sync), fake payments, `BILLING_PROVIDER=fake`, the fake human check, open sign-up on, **production build** on port 3140 (the staff console `apps/admin` ran in dev mode on 3141 because its production build ran out of memory in `tsc`). No Anthropic key was used. No integration tests were run (they would reset the shared Postgres role passwords).
Screenshots are in `C:\Users\ADMIN\.claude\projects\D--yayatoh-2-0-yayatoh--claude-worktrees-qa-baseline-a94866\8e728a03-1454-42dd-9484-ed2066dd2cef\tool-results\`.

## 1. Merge notes

- `batch-3` merged cleanly. `batch-2` and `claude/bold-aryabhata` conflicted only in `apps/web/messages/*.json` (13 locales) and the drizzle journal. Messages: union of all keys (three-way merge; 302 top-level namespaces per locale).
- Migrations: `main` ends at `0192`. Batch 2 adds `0193_site_pages_contact`. Batch 3 added `0197_venue_type`: **renumbered to `0194_venue_type`** (SQL and snapshot renamed). `claude/bold-aryabhata` adds none. The journal is now 194 entries, no duplicates, in order (the pre-existing gap at 0189 remains). Snapshot chain relinked and `0194_snapshot.json` regenerated by drizzle-kit as the full schema; `drizzle-kit generate` says "No schema changes". Committed on `qa-r2` as "fix(db): renumber venue_type to 0194…".
- `pnpm install` ok. `tsc --noEmit` on `apps/web` (12 GB): **0 errors**. `next build` (with type-check): ok.
- **`pnpm check:modules` FAILS with 7 violations (all from batch 3 / R2-A):** `apps/web/src/app/[locale]/venues/page.tsx` has three native `<select>`; `apps/web/src/components/showcase/hero-search.tsx` has a native `<select>` and two native `type="date"` inputs; `apps/web/src/components/venue-form.tsx` has a native `<select>`. The house rule is to use `Select` / `DatePicker` from `@yayatoh/ui`. Severity: major for CI (the check blocks merge); `tools/check-modules/tests/check.test.ts` fails for the same reason.
- `pnpm test` (unit): 343 of 362 files pass; failures are the known Windows-only ones plus these **new** ones: `check-modules` test (above) and `packages/testing/tests/column-privacy.test.ts`: `venues.venues.venue_type (text) is neither private nor public. Add venue_type: ... in packages/modules/venues/src/private-columns.ts` (batch 3 forgot the declaration; major for the canary test).
- Environment notes: self-service paid sign-up needs `BILLING_ENABLED=1` (otherwise the payment step fails, see B3); the plans and their prices were "not on sale" (inactive in `billing.plan_catalog` / `plan_prices`) until I activated them in the database; dev auth codes are printed in the server log; the staff role came from the worker CLI.

## 2. The client's eight points

(The mapping follows the lead's message: 1 per-type event pages, 2 home hero finder, 3 Venues in the top bar, 4 venue directory, 5 About/Contact/legal pages managed in admin, 6 messaging, 7 self-service sign-up, 8 UI consistency.)

| # | Point | Status | Evidence |
|---|---|---|---|
| 1 | Event page per type | PARTIAL | All nine demo events (wedding, gala x2, conference, concert, community, tour, agency, other) load with the type's own look (e.g. gala uses a serif heading and gold accent, wedding has a "Save the date" card); all fit at 375 px in dark and light with no overflow. Checkout itself was **not** re-run on every type this round (earlier rounds covered it). Bugs B1 (floating bar covers content) and B2 (wedding labels). |
| 2 | Home hero slider and finder | DONE | Slider of five featured events with pause and slide dots; finder with keyword, city (6 cities), date chips (Any, Today, This weekend, This month, Pick dates) and "Use my location". Search with "workshop" + New Delhi + This month goes to `/events?q=workshop&city=New+Delhi&from=2026-11-01&to=2026-11-30` and shows exactly the pottery workshop. "Use my location" denied: message "…Choose a city instead."; allowed (I stubbed the browser's geolocation to Delhi): "Nearest city: New Delhi" and the city is preselected. |
| 3 | Top bar shows Venues | DONE | Top bar: Events, Organizations, Weddings, Galas, Conferences, **Venues**, My tickets, For organizers, Sign in / Dashboard, Sign up. (`/pricing` still exists.) |
| 4 | Venue directory | DONE | `/venues`: six venues as cards with thumbnails and a type badge (Outdoor, Ballroom…); filters Search, City (6), Type (Lounge, Ballroom, Conference centre, Outdoor, Restaurant, Hotel, Other), Size (up to 100, 101 to 500, over 500). `?type=ballroom` gives one venue. Minor: the large "VENUE DIRECTORY" title is a very pale colour on the pale hero in light theme (low contrast, `...1793480528578-m90zjp.jpg`). |
| 5 | About, Contact, legal pages managed in admin | DONE | `/about` ("Events, made simple"), `/privacy`, `/terms`, `/cookies`, `/sub-processors`, `/contact` all load. Contact form (name, email, subject, message, human check, honeypot) shows "Thanks, your message was sent"; two emails were produced (a confirmation to the sender "We got your message" and one to support@yayatoh.com); the message appears in the admin "Contact messages" inbox as New; replying from the admin ("Reply sent.") mailed "Re: QA question about white label" to the sender and the message shows Replied. Admin "Site content > Pages" lists Cookie policy, Privacy notice, Sub-processors, Terms; editing Privacy and publishing created **Version 2** (Version 1 listed as "migration") and the public `/privacy` showed the new paragraph at once and "version 2". Minor: the public page's "Last updated September 27, 2026" did not change; the admin shows the editor as a raw user id. |
| 6 | Messaging (1:1 chat, lobby, booth chat, announcements) | NOT RETESTED | Not exercised this run (earlier rounds tested networking, lobby and 1:1 chat). |
| 7 | Self-service sign-up | DONE with bugs | **Free:** `/signup` plan picker (Free, Starter $29/month, Pro $99, White label/Agency $249, Enterprise "Talk to sales"; Monthly/Yearly), email code, org name/slug/terms/human check, "Create my organization" creates the org at once on the Free plan (`billing.org_plans` = `tier_free`); the new owner must then set up two-step verification before the console opens. **Paid (Starter):** "Continue to payment" ($29.00 due today) goes to the fake checkout page: **Decline** returns to "Payment cancelled… Try the payment again"; retry then **Pay (test)** finished and the org is on `tier_starter` (database). I did not see a distinct welcome page (it went straight to the two-step requirement). **Enterprise popup** on `/for-organizers`: "Talk to our sales team" form (type, country, name, email, event types, white label, message, human check) validates the country and shows "Thank you, we have it"; the application appears in the admin "Organizer applications" queue as New with plan interest Enterprise. Bugs B3 to B6. |
| 8 | UI/UX consistency, light and dark, phone, CSP | PARTIAL | Theme menu (Light, Dark, System) works and the dark theme is applied across pages; no horizontal overflow at 375 px (dark) on home, signup, for-organizers, venues, about, contact and seven of the event pages (I did not re-measure `/events` and the pottery and agency pages at 375 in this run). **CSP in production: 0 console errors** on home (scrolled to the bottom), gala event page, venues, signup, for-organizers and about, in a clean tab. Visual issues: B1, B7, B8. |

## 3. Bugs

| # | Severity | Bug |
|---|---|---|
| B1 | major | **The floating "Get tickets" bar covers content.** On `/events/demo-gala-starlight-charity` the sticky pill at the bottom of the viewport stays on top of the pass cards: at the first scroll it hides most of the Patron table seat price ("$500"), and when the seats section is in view it sits on top of the seat checkboxes (`...1793479949121-wons1h.jpg`, `...1793479952568-ma6ern.jpg`); at 375 px it ghosts over the "Choose your pass" heading (`...1793480638322-go9yw4.jpg`). Steps: open the gala page, scroll 1 to 3 screens. Expected: the bar hides while the pass section is on screen (or never overlaps the price). |
| B2 | minor | **Wedding page mixes "Get tickets" and "RSVP".** The top bar and hero buttons say "Get tickets", the floating bar says "RSVP", and all three go to `#passes`. Expected one wording (RSVP for a wedding). |
| B3 | major | **Paid sign-up fails silently when billing is not enabled.** With `BILLING_ENABLED` unset the app creates the organization and then shows "We could not start the payment" without any log: `self-serve-actions.ts` catches the error and drops it (`void err`). Operators cannot tell why. Fix: log the error and show a sensible message when billing is off. |
| B4 | major (deployment) | **All plans show "Not on sale yet"** until staff set the plan catalog and prices active (`active=false` after catalog sync), so `/signup` cannot sell anything out of the box. If that is by design, the admin "Plans & billing" page should make it a one-click step and the signup page should say what to do; I changed it directly in the database. |
| B5 | minor | An unknown `plan` value in the sign-up link (I used `tier_starter` instead of `starter`) silently falls back to Free and creates a free organization, no warning. |
| B6 | minor | After sign-up (free or paid) the owner is sent to the "Two-step verification is required" page before anything else, so "instant access" is not instant (this is the existing owner rule; a note on the sign-up page would help). Also the plan page of a new org says "Subscriptions aren't switched on yet" even right after a paid plan was bought (with `BILLING_ENABLED=1` on the web server only). |
| B7 | minor | Large page titles are very pale on the light theme: "VENUE DIRECTORY" and the first line of "PICK YOUR PLAN, START TODAY" look washed out or half cut off (`...1793479967904-ex1mf6.jpg`). |
| B8 | minor | Demo data: the featured "Old City Heritage Walk" is shown at "Tech Park Convention Centre" (venue mismatch); the demo events' time zone is New York for Indian venues (seed data). |
| B9 | minor | Privacy page "Last updated" date stays at the seed date after a new version is published. |
| B10 | cosmetic | Admin contact reply shows "Sent by <user id>". |
| B11 | major (CI) | `pnpm check:modules` fails (7 native select/date violations, R2-A) and the `column-privacy` test fails for `venues.venues.venue_type`. |
| B12 | minor | `apps/admin` production build runs out of memory in the type-check on this machine (works in dev). |

## 4. Not covered

Checkout on every event type (only the pages and the passes areas were checked); messaging (point 6: 1:1 chat after connecting, lobby, booth chat, organizer announcement); the Enterprise popup on `/signup` itself (only the one on `/for-organizers`); the welcome page after payment; the Yearly billing interval and the other paid plans; light-theme measurement at 375 px for all pages; a reply email's content beyond its subject; admin editing of About and the contact details.
