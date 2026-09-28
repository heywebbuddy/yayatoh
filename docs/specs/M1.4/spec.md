# M1.4 — Events, venues and content

**Roadmap:** Phase 1 → M1.4. **Risk tags:** `db-migration`, `tenancy` (owner approval).

## M1.4a — events core (this change)
- **Module `events` (tier 2), schema `events`:**
  - `events`: global slug, profile, status, visibility, IANA timezone, start/end times, venue, city, country and currency, with CHECK constraints.
  - `event_role_assignments`: event-scoped roles with optional expiry. The composite foreign key follows the tier rules.
- **Lifecycle** (`defineStateMachine` in the kernel): draft → published ⇄ draft, published → postponed → published (reschedule), draft/published/postponed → cancelled, published → completed, completed/cancelled → archived.
  - One `transitionEvent` command enforces it with `UPDATE … WHERE status = ANY(from)`.
  - Each transition is audited and emits `event.<past tense>@1`.
- **Slugs:** derived from the name, global (public URL `/events/{slug}`), and **frozen once published**.
- **Public read:** only through `events.public_event(slug)` (SECURITY DEFINER). It returns published, postponed, cancelled or completed events that are public or unlisted, from active orgs, with allowlisted columns (`PublicEventDto`).
- **Time:** organizers enter wall-clock times in the event's zone. `zonedTimeToUtc` handles the DST gap (moves forward) and overlap (earlier instant), and the conversion is tested.
- **Web:**
  - Org home lists real events, with a Suspense skeleton while loading.
  - A create-event form (Server Action).
  - The event console loads the real event (404 for foreign or unknown slugs), shows status plus lifecycle actions, and uses readiness v1 rules (details, venue, description, published).
  - The public event page is real. Tickets show an empty state until M1.5.
- **Demo overlay:** the seeded showcase events keep their demo sales, attendees, passes and agenda **in dev/preview only**, so the reference screens stay reviewable.

## Acceptance (M1.4a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Events follow the lifecycle; illegal transitions return `invalid_state` | `packages/testing/tests/events.int.test.ts`, `events/tests/lifecycle.test.ts` |
| AC2 | Slugs are unique across orgs and frozen after publish | `events.int.test.ts` |
| AC3 | Drafts and private events never have a public page; the public payload is allowlisted | `events.int.test.ts`, `e2e/events.spec.ts` |
| AC4 | Isolation: another org's event is invisible and cannot be transitioned; the fixture covers the new tables | `events.int.test.ts`, `isolation.int.test.ts` |
| AC5 | An owner creates, publishes and sees the event publicly; a viewer cannot create | `e2e/events.spec.ts` |
| AC6 | Wall-clock times convert correctly across DST | `kernel/tests/time.test.ts` |

## M1.4b — occurrences, series, templates and duplicate (this change)
**Risk tags:** `db-migration`, `tenancy` (owner approval). Migration `0039_workable_lenny_balinger.sql` (renumber on merge).

- **Dates (occurrences)** — `events.occurrences`: start/end `timestamptz`, optional capacity, `scheduled`/`cancelled`. An event without dates is a single-date event (its own times); with dates, the event's times are kept equal to the span of its scheduled dates, so lists, the public page and check-in windows stay right.
  - Added one by one, or from a **recurring schedule** (`domain/recurrence.ts`, an RFC 5545 subset): daily, weekly on chosen weekdays, monthly on a day of the month; every *n*; until a date (inclusive) or a count. It is expanded in the event's **wall-clock time**, so a 7 pm weekly event stays at 7 pm across DST (tested for America/Chicago and Europe/London; a time in a DST gap moves forward, an overlap takes the earlier instant). Months without the chosen day (the 31st) are skipped. Limits: 366 scheduled dates per event, 5 years ahead. The console **previews** the dates before saving and names every validation problem next to its field.
  - **Edit one date** (new start/end), or **this and all later dates** (new start/end time of day; each keeps its local day, so DST never shifts them). Optional capacity per date.
  - **Cancel a date**: the console first shows the impact (tickets sold for it) and links to the orders. Refunds are not automatic. A cancelled date stops selling, its tickets no longer get in, and it stays listed (marked) publicly.
- **Ticket validity per date** — ticket types list the dates they sell for (`occurrence_ids`, empty = every date). A multi-date event sells **one date per order** (`orders.occurrence_id`); the ticket carries it (`tickets.occurrence_id`). A date's capacity counts live tickets for it plus tickets in orders still holding stock, under a row lock on the date (online checkout and the box office).
  - **Rule with access dates (M1.5 multi-day passes)**: the two stay separate and both apply. The date (occurrence) says *which run* a ticket is for; access dates say *which calendar days* a pass admits within the event. Tickets without a date (guest list, imports, passes sold before the event had dates) admit on every date.
- **Check-in**: new verdict **`wrong_date`** (shared rules, online and offline). A ticket for a date admits from 6 h before to 6 h after it (the same margins as the event window), never on a cancelled date. The offline manifest header lists the dates; each row carries its date.
- **Public**: the event page shows a keyboard-friendly **date picker** (plain links, `aria-current`); sold-out and cancelled dates are listed but not selectable, capacity numbers never leave (`events.public_occurrences`). Passes appear once a date is chosen, filtered to that date. The order page and PDF show each ticket's date in the event's timezone.
- **Series** — `events.series` (+ `series_events`, one series per event): name, global slug, description. Console: an org **Series** page (create, delete, public link), a series picker on each event's Dates page, and a **series filter** on the org's event list. Public: `/series/{slug}` lists upcoming **public** events (`events.public_series*`, SECURITY DEFINER, allowlisted).
- **Duplicate and templates** — new tier-5 module `templates` (`templates.event_templates`). **Duplicate** creates a new **draft** with a new slug, the same settings, live ticket types (nothing sold, every date), checkout questions, floor plan (a draft, categories remapped, organizer blocks kept) and series; sales windows and early-bird ends move with the new start. **Save as template** stores the same snapshot (versioned JSON, instants relative to the start); **Create from template** instantiates it. Never copied: orders, tickets, attendees, check-ins, payouts, promo codes, dates, holds, guest seat assignments.
- **Web**: event nav gains **Dates** and **Duplicate & template** (every profile); org nav gains **Series** and **Templates**; "Start from a template" on the new-event page. All strings in 13 locales (Arabic RTL).

### Migration `0039_workable_lenny_balinger.sql`
- New: `events.occurrences`, `events.series`, `events.series_events`, schema `templates` with `templates.event_templates` (all `tenantTable`, FORCE RLS, org-leading indexes, composite FKs).
- Existing tables (nullable/defaulted columns only): `ticketing.ticket_types.occurrence_ids uuid[] default '{}'`, `ticketing.tickets.occurrence_id`, `orders.orders.occurrence_id` (+ partial indexes).
- Hand-written (between `-- hand-written: begin/end`): `scans_result_check` re-added with `wrong_date` as `NOT VALID` + `VALIDATE`; cross-module composite FKs `tickets_occurrence_fk` and `orders_occurrence_fk` → `events.occurrences` (`NOT VALID` + `VALIDATE`); SECURITY DEFINER functions `events.public_occurrences(text)`, `events.public_series(text)`, `events.public_series_events(text, timestamptz)`, `ticketing.public_ticket_type_occurrences(text)` with `REVOKE … FROM PUBLIC` / `GRANT EXECUTE … TO app_user`.

### Later / not yet
- Stored recurrence rules (extend a schedule, "all dates" edits of the rule); exceptions (EXDATE) other than cancelling a date.
- Per-date seat charts (M1.7f); per-date check-in counts on the door screen; filtering the orders list by date; bulk refunds of a cancelled date (M1.6 refunds are per order).
- Reducing a date's capacity below what it already sold is allowed (only new sales are refused).
- Duplicating dates with an event; template editing (a template is replaced by saving a new one).

## Acceptance (M1.4b)
| ID | Criterion | Test |
|---|---|---|
| B1 | Recurrence: daily/weekly/monthly, until/count, DST in America/Chicago and Europe/London, the 31st, limits and every validation reason | `events/tests/recurrence.test.ts` |
| B2 | Occurrence CRUD: preview writes nothing, save, single dates, duplicate start refused, edit one / this and following, event span follows | `testing/tests/occurrences.int.test.ts` |
| B3 | Cancelling a date: impact counts, no refund, stops selling, can't be edited | `occurrences.int.test.ts`, `e2e/dates.spec.ts` |
| B4 | Ticket validity per date, a date is required, per-date capacity (checkout and box office), ticket carries its date | `occurrences.int.test.ts`, `e2e/dates.spec.ts` |
| B5 | Check-in `wrong_date` online and offline; cancelled dates never admit | `checkin-engine/tests/dates.test.ts`, `occurrences.int.test.ts`, `e2e/dates.spec.ts` |
| B6 | Series: public page lists upcoming public events only, global slugs, isolation, viewer denied, console filter | `occurrences.int.test.ts`, `e2e/series-templates.spec.ts` |
| B7 | Duplicate never copies orders, tickets, attendees, check-ins, settlements, promo codes, dates, held/sold seats, seated guests (row counts) | `testing/tests/templates.int.test.ts`, `e2e/series-templates.spec.ts` |
| B8 | Templates: save, create from, unique names, isolation across orgs, viewer denied | `templates.int.test.ts`, `e2e/series-templates.spec.ts` |
| B9 | Fixture covers the new tables for both orgs (isolation suite) | `testing/tests/isolation.int.test.ts` |
| B10 | UI: recurring schedule with preview and validation errors, edit one / following, cancel with impact, buyer picks a date and the ticket shows it, scanner rejects on another date, viewer denied (hidden controls and direct URLs), keyboard, axe on every new screen and state, Arabic RTL, 375 layout | `e2e/dates.spec.ts`, `e2e/series-templates.spec.ts` |

## Remaining M1.4 increments
- **M1.4b:** done (above).
- **M1.4c:** venues (directory, org-owned, quote requests), categories and tags. **Done, see below.**
- **M1.4d:** content sections, announcements, the private-info portal, access codes, short URLs, online events. **Done, see below.**
- **M1.4e:** media pipeline (R2 + re-encode, SVG neutralized; blocked on the owner's Cloudflare account).
- **M1.4g:** tenant CMS (pages and blog) and event reviews. **Done, see below.**
- **M1.4f:** lightweight sessions, speakers, exhibitors and sponsors; AI drafting with the credits ledger.
- **Authorization for event roles** (`scopeFilter()`) arrives with the first event-role consumer, check-in in M1.9. The assignments are stored now.

## M1.4c — venues, categories and tags (done)
- **Module `venues` (tier 1, schema `venues`)**, per the roadmap's module tiers:
  - `venues`: org-owned venues. Name, address lines, city, region, postal code, ISO 3166-1 alpha-2 country, optional latitude/longitude (a pair, range-checked), IANA timezone, capacity, accessibility notes, `https://` map link, `directory_listed`, `archived_at`. The slug is global (`/venues/{slug}`), made from the name with a random suffix on a clash.
  - `quote_requests`: public "request a quote" enquiries (name, email, phone, event date, guests, message, status `new`/`handled`). Contact data, so reading needs `events:write`.
  - Venues are archived, never deleted. Archiving takes the venue out of the directory and out of the event picker.
  - Public reads use SECURITY DEFINER functions with allowlisted columns (`PublicVenueDto`, `DirectoryVenueDto`): `venues.directory()`, `venues.public_venue(slug)`, and `venues.quote_target(slug)` (server-side only).
- **Events** (existing table; expand step):
  - `venue_id`: a composite FK to `venues.venues`, added `NOT VALID` then `VALIDATE`.
  - `category`: the platform taxonomy `EVENT_CATEGORIES`, 16 keys translated under `categories.*`.
  - `event_tags`: org tags, case-insensitive per event, at most 10 per event.
  - Picking a venue copies its name, city and country into the free-text fields. Those fields still render everywhere, and events without a venue keep working (the contract step comes later).
- **Spam and abuse on the quote form:**
  - A hidden honeypot field: a bot that fills it gets a success response and nothing is stored.
  - At most 3 requests per hour per device key (an HMAC of a device cookie, never an IP) per org, and per email per venue.
  - Turnstile is added once the owner's site key exists (owner inbox, M1.2f).
  - `venue.quote_requested@1` is emitted for M1.10 notifications.
- **Web:**
  - `/o/{org}/venues`: list with an archived toggle, plus create. `/o/{org}/venues/{id}`: edit, archive or restore, the public link, and the quote inbox with mark handled / new.
  - The event console's **Details** page (new nav item in every profile) sets the venue, category, tags, visibility (public / unlisted / private) and attendance mode.
  - The org home events list filters by category and tag (GET form, bookmarkable).
  - Public pages: `/venues` (directory) and `/venues/{slug}` (details, upcoming **public** events at the venue, quote form). The public event page shows the category and links the directory venue.
  - Seed: a listed "Lakeside Pavilion" venue.

## M1.4d — content, announcements, private info, access codes, short links, online events (done)
- **Content sections** (`events.event_sections`):
  - Ordered blocks, typed per kind with Zod: `text` (sanitized Markdown), `faq`, `schedule` (`HH:MM | title | detail`), `location` (address, directions, map link) and `links` (http(s) only).
  - The console edits list-shaped kinds as plain text. Parse errors name the line.
  - Reordering: drag a row, or use the **Move up / Move down** buttons (the keyboard and screen-reader path). Every move is announced in a live region and focus stays on the moved row. A stale drag order is refused (`conflict`).
  - Sections can be hidden, edited and deleted.
- **Markdown** is a small subset parsed to a tree and rendered as React elements. Raw HTML stays literal text, and only `http(s)` and `mailto` links survive (`rel="noopener noreferrer nofollow"`). Control and bidi-override characters are stripped.
- **Announcements** (`events.event_announcements`):
  - Title, Markdown body, audience (`public` or `holders`), pinned, and publish/unpublish (a draft has `published_at` null).
  - Each publish emits `event.announcement_published@1` (payload: org, event, announcement id, audience, title, pinned) for M1.10 email and push. No email is sent here.
  - Public announcements show on the event page. Every published one shows to ticket holders.
- **Private info** (`events.event_private_info`): organizer-written Markdown plus, for online or hybrid events, the join link and how many minutes before the start it appears (default 30).
  - Never read by any public function or serializer: not in the public page HTML, the JSON-LD, the OG tags or any API payload.
  - Ticket holders see it on their verified pages: the buyer's `/orders/{manageToken}` (while they still hold a live ticket) and the holder link `/my-tickets/{token}` (M1.8d).
  - The join link shows only from the window's start until the event ends. Before that, the page shows when it appears.
  - Only `events:write` roles can read it in the console; viewers get a notice instead.
- **Online events:** `events.attendance_mode` is `in_person`, `online` or `hybrid`. The public page shows a badge, and the JSON-LD carries `eventAttendanceMode` with a `VirtualLocation` that points at the **event page**, never the join link. The feature is platform-agnostic (any https link).
- **Access codes** (`events.access_codes`, entitlement `access_codes`):
  - A code unlocks a private event's page, hidden passes, or both. Codes are case-insensitive, generated if left empty, with an optional use limit and expiry (in the event's timezone), and can be deactivated.
  - `redeemAccessCode` gives one answer for wrong, expired, inactive and used-up codes. After 10 failed attempts per device key per event in 15 minutes it returns `rate_limited` (`events.access_code_attempts`).
  - A success counts one use atomically and is remembered in a signed, httpOnly cookie. The server re-checks the grant on every request and at checkout (`startCheckout.accessCodeId`), so a deactivated or expired code stops working at once.
  - Hidden passes need a grant that names them (`ticketing.public_ticket_types_v3`, `quoteTx`).
  - A private event's URL stays a **404** until a code opens it (M1.4a AC3 holds). Codes are entered at `/events/{slug}/unlock`, a page that renders the same form for any address and never looks the event up, so it can't reveal whether a private event exists; on success it goes to the event page. The console's Access page shows the unlock link for private events. An unlocked private page has no JSON-LD and is `noindex`.
  - The ticket-type form gained a **Hidden pass** option.
- **Short links** (`events.short_links`):
  - Every event gets a 7-character automatic code (unambiguous alphabet) when it is created. Existing events were backfilled in the migration.
  - An event can also have one vanity code: 3–40 characters of a–z, 0–9 and single hyphens, not a reserved word, case-insensitive.
  - Codes are globally unique, so they never collide across orgs. `/e/{code}` answers **308** to `/events/{slug}` (`Cache-Control: no-store`), and only for events with a public page; drafts and archived events are a 404.
  - The console's Details page shows the links and the vanity form, with the specific validation messages.
- **Public event page:**
  - Announcements, sections, category and attendance badges, a directory venue link, and the access-code form.
  - JSON-LD (`schema.org/Event`) is built from the allowlisted public payload for public events only. `generateMetadata` sets the title, description and OG tags, and `noindex` for unlisted and private events.

**Migration** `0039_giant_hannibal_king.sql` (the orchestrator renumbers it):
- New schema `venues` with `venues` and `quote_requests`.
- New events tables: `event_tags`, `event_sections`, `event_announcements`, `event_private_info`, `access_codes`, `access_code_attempts` and `short_links`. All have ENABLE + FORCE RLS and the NULLIF policy, indexes leading with `org_id`, and composite FKs to `events.events`.
- New columns on `events.events`: `venue_id`, `category`, `attendance_mode` (default `in_person`).
- Hand edits, between `-- hand-written: begin/end`:
  - `events_category_check` and `events_attendance_mode_check` are `NOT VALID` then `VALIDATE`.
  - `venues_org_fk`.
  - `events_venue_fk` (`NOT VALID` + `VALIDATE`).
  - The SECURITY DEFINER functions `events.public_event_v2`, `events.page_target`, `events.access_target`, `events.short_link_target`, `events.public_events_at_venue`, `venues.directory`, `venues.public_venue`, `venues.quote_target` and `ticketing.public_ticket_types_v3`. Each has `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE TO app_user`.
  - The backfill of automatic short codes for existing events.
- Expand/contract: `public_event` (v1) and `public_ticket_types_v2` stay until nothing calls them.
- `packages/db/drizzle.config.ts` also reads `modules/*/src/schema-*.ts`, so the events content tables live in a new file and don't collide with M1.4b.

## Later / not yet (M1.4c–d)
- **Venues:**
  - Claimable platform venue profiles and an unclaimed-venue ops inbox (research/37; M1.11 / M6.14).
  - Venue photos (media pipeline, M1.4e) and a map embed (needs a map provider).
  - A quote pipeline beyond new/handled.
  - Email to the organizer on a new quote (M1.10 subscribes to `venue.quote_requested@1`).
- **Turnstile** on the quote and access-code forms once the site key exists. A Redis limiter (Upstash) replaces the Postgres counters with the owner's account.
- **Announcements:** editing the text of an existing announcement (today: create, publish/unpublish, pin, delete). Email and push delivery come from M1.10.
- **Legacy:**
  - Migrating legacy `short_url` values as vanity codes, plus the `/events/{slug}/tag_{tag}` pages (M1.11, ELT).
  - Legacy categories mapped to the taxonomy (ELT).
  - Code-joined attendees reading private info (legacy "event code portal"). Today private info is for ticket holders only; see the owner inbox.
- The **contract step** for the free-text venue fields, and dropping `public_event` v1 and `public_ticket_types_v2`.
- The **API** (`/v1`) has no endpoints for this content yet. The legacy `/api/v2` facade is untouched.

## Acceptance (M1.4c–d)
| ID | Criterion | Test |
|---|---|---|
| C1 | Org venues with validated address, ISO country, paired geo, timezone, capacity, accessibility notes and an https map link; field errors in the UI | `packages/testing/tests/venues.int.test.ts`, `apps/web/e2e/venues.spec.ts` |
| C2 | Picking a venue fills the event's place and free-text fields keep working; foreign and archived venues are refused | `venues.int.test.ts`, `e2e/venues.spec.ts` |
| C3 | The public directory and venue page are allowlisted, list only listed/live venues and upcoming public events | `venues.int.test.ts`, `e2e/venues.spec.ts` |
| C4 | Quote requests are stored for the organizer only, rate-limited and honeypot-protected; viewers and other orgs can't read them | `venues.int.test.ts`, `e2e/venues.spec.ts` |
| C5 | Categories (platform list, 13 locales) and org tags filter the console events list | `venues.int.test.ts`, `events/tests/content.test.ts`, `e2e/venues.spec.ts` |
| D1 | Sections are validated per kind, reorder by drag and by keyboard, and render (FAQ, sanitized text) publicly | `events/tests/{markdown,content}.test.ts`, `event-content.int.test.ts`, `e2e/event-content.spec.ts` |
| D2 | Announcements publish/unpublish/pin; holders-only never reach public reads; one domain event per publish | `event-content.int.test.ts`, `e2e/event-content.spec.ts` |
| D3 | Private info and the join link never appear in public outputs (serialized payloads, HTML, JSON-LD, OG); holders see them after link verification, the join link only in its window | `event-content.int.test.ts`, `e2e/event-content.spec.ts` |
| D4 | Access codes: case-insensitive, per-code use limit and expiry, one answer for all failures, attempt limit, org isolation; unlock hidden passes (and checkout) and private event pages | `events/tests/access-code.test.ts`, `event-content.int.test.ts`, `e2e/event-content.spec.ts` |
| D5 | Short links: automatic per event, vanity validation, global uniqueness across orgs, 308 to the canonical URL, drafts/archived don't resolve | `events/tests/short-code.test.ts`, `event-content.int.test.ts`, `e2e/event-content.spec.ts` |
| D6 | Isolation: every new tenant table has fixture rows for both orgs | `isolation.int.test.ts` |
| D7 | Viewers are denied on every new organizer screen (hidden controls and server refusal); axe on every state; Arabic RTL; no horizontal scroll at 375 | `e2e/venues.spec.ts`, `e2e/event-content.spec.ts` |

## M1.4g — tenant CMS (pages and blog) and event reviews (done)
**Risk tags:** `db-migration`, `tenancy` (owner approval). Defaults pending the owner are listed in `docs/owner-inbox.md` ("Tenant CMS and reviews").

**Legacy (reference only):** yayatoh.com and abc.yayatoh.com run Voyager `posts` and `pages` as the CMS: `/blogs` (12 per page), `/blogs/{slug}`, `/pages/{slug}`; abc uses posts as landing pages ("Become a vendor", "Book your hotel"). Reviews are a `reviews` table with a per-event `show_reviews` switch and organizer ratings (research/10). The new paths are the same, so abc URLs stay identical.

### Module `cms` (tier 1, schema `cms`)
- **Tier:** the roadmap's "content" slot (§3.5). It needs no other module: the author is the acting member (`ctx.actor`) with a display-name snapshot from the console session. Marketplace (tier 6) reads it for the navigation and sitemaps.
- **`cms.entries`** (tenant table): `kind` page | post, `slug`, `title` (1–160), `excerpt` (≤ 300), `body` (≤ 20,000, the M1.4d Markdown subset), `status` draft | published | archived, `published_at`, `seo_title` (≤ 70), `seo_description` (≤ 160), `author_user_id`, `author_name`. CHECKs on every length and enum; `UNIQUE (org_id, kind, slug)`.
- **Slugs:** lowercase `a-z0-9` with single hyphens, ≤ 80. Derived from the title (accents folded) with a `-2`, `-3` suffix on a clash when left empty; a typed slug must be free (`conflict`, reason `taken`) and well formed (reason `format` / `too_long`). **Frozen once first published** (reason `frozen`).
- **Bodies** are sanitized on every write (`sanitizeMarkdown`: control and bidi-override characters stripped, length capped) and parsed to React elements on every render (raw HTML stays text; only http(s)/mailto links). The Markdown subset moved from `events` to `@yayatoh/contracts` so tier 1 can use it; `events` re-exports it unchanged.
- **Lifecycle:** draft → published ⇄ draft (unpublish), draft/published → archived, archived → published. Re-publishing keeps the first `published_at`. Delete removes the row.
- **Commands** (`tenantCommand`, audited): `createEntry`, `updateEntry`, `setEntryStatus` (publish / unpublish / archive), `deleteEntry`. Permission `marketing:write` (owner, admin, manager, marketing); reads `org:read` (viewers included). **Events:** `cms.entry_created@1`, `cms.page_published@1`, `cms.post_published@1`, `cms.entry_unpublished@1`, `cms.entry_archived@1`, `cms.entry_deleted@1` (payload org, entry id, kind, slug).
- **Public reads** (under the org's RLS; the org comes from the host or the organizer slug, never the request): `publicEntries` (12 per page, newest first), `publicEntry`, `navPages`, `sitemapEntries`, through allowlisted DTOs (no ids, no author account). Drafts and archived entries are 404.
- **Hook (M1.4e):** no cover image yet. The media pipeline adds `cover_media_id` and a `cover` field on the public DTOs; the JSON-LD `image` uses the org's OG image until then.

### Web: CMS
- **Console** "Pages & blog" (`/o/{org}/content`, org nav `siteContent`): Blog posts / Pages tabs, status and update date, "New post / New page", the editor (title, address, summary, Markdown text with a **Preview** toggle that renders exactly like the public page, search title and description), field errors next to their fields, Publish / Unpublish / Archive, **Delete with a confirmation step** (focus moves to "Yes, delete"; Cancel returns it). Viewers see a read-only note and the rendered text, no controls; `/content/new` refuses them; a stale form is refused by the server.
- **Public routes** (the legacy paths): tenant sites `{host}/blogs`, `/blogs/{slug}`, `/pages/{slug}` (proxy rewrites to `/t/{org}/…`); organizer pages on the marketplace `yayatoh.com/o/{slug}/blogs[/{post}]`, `/o/{slug}/pages/{page}` (`/organizers/…` 308s there); the marketplace's own `/blogs`, `/blogs/{slug}`, `/pages/{slug}` show the org named in `MARKETPLACE_CONTENT_ORG` (the platform org at ELT; unset = 404).
- **Canonical** (as events, roadmap §4.2): the content org → the apex; an org with a tenant site → its primary host; otherwise the apex organizer path. 13 hreflang + x-default; later blog-index pages are `noindex`. **JSON-LD `BlogPosting`** on posts (headline, dates, author Person or the org, publisher, canonical URL; `<` escaped). Post dates in the org's timezone.
- **Sitemaps:** a tenant host lists its org's `/blogs` and entries when it is their canonical home; the marketplace lists `/o/{slug}/…` content of listed organizers without a tenant site, and the content org's `/blogs` and `/pages/…`.
- **Caching:** every public CMS read goes through `publicCached({ org })` (org-scoped key and tag); every console write calls `updateTag` on the org's tags (and the marketplace's), so publishing shows at once.
- **Navigation:** Public site → **Site navigation** lists the org's pages (drafts marked); checked ones are stored in `marketplace.site_settings.nav_page_ids` (≤ 8, validated as this org's pages by `pageIdsTx`) and appear in the tenant site header after "Blog" once published. The organizer page links "Blog" when there are posts.

### Module `reviews` (tier 5, schema `reviews`)
- **Tier:** eligibility reads the buyer's order and tickets (`orders`, tier 4, via the new `orderHoldingTx`) and the event (`events`, tier 2) inside the review's own tenant transaction. Composite FKs point down: `reviews → events.events`, `reviews → orders.orders`.
- **`reviews.reviews`:** event, order, `author_key` = SHA-256(org id ∶ normalized buyer email), `author_display` ("First L."), `rating` 1–5, `body` (plain text ≤ 1,000, control/bidi characters stripped), `status` visible | hidden, `hidden_reason` (required when hidden, ≤ 300), `moderated_at/by`. **`UNIQUE (org_id, event_id, author_key)`**: one review per holder per event, also under concurrency and across several orders of the same person. **`reviews.review_reports`:** reason (spam, offensive, off-topic, personal info, other), note ≤ 500, reporter key (hashed device), status open | dismissed | actioned; one per reporter per review.
- **Eligibility** (`domain/eligibility.ts`, pure): the buyer still holds a live ticket; the event took place (published, completed or archived: not cancelled or postponed); **the ticket's date has ended** (an instant: a multi-date ticket uses its own date, else the event's end), so a late evening in Los Angeles is still "not ended" on the next UTC day; the window closes at **the end of the local calendar day 90 days after the last date's end, in the event's timezone**. **A valid ticket qualifies without check-in (pending owner)**: many events never scan, and a no-show still paid.
- **Commands:** `submitReview` (`public:review_submit`; the manage-link token is re-verified under the org's RLS; refusals carry `reason` not_ended / window_closed / not_held / no_ticket / already_reviewed), `hideReview` / `unhideReview` (reason required, `events:write`, so event managers too; audited with the reason), `dismissReports`, `reportReview` (`public:review_report`, visible reviews only). `listReviewsQuery` (`events:read`: viewers read) with filters all / visible / hidden / reported. **Events:** `review.submitted@1`, `review.hidden@1`, `review.unhidden@1`, `review.reported@1`.
- **Public read** `publicReviews(org, event)`: count and mean of visible reviews (one decimal) and the 5 latest through `PublicReviewDto` (rating, text, "First L.", date, and an id to report it). **No email, order or full name** ever leaves.

### Web: reviews
- **Order page** (`/orders/{token}`, M1.5 manage link): "Review this event" with the window's closing date, a 1–5 radio group (arrow keys) and optional text with a character count; "you can review once it ends ({date})" before the end; "closed on {date}" after; the buyer's own review afterwards (with a note if the organizer hid it). Submissions are rate-limited (`reviewSubmit`: 5 per device per 10 min, 5 per order per hour).
- **Public event page:** a "Reviews" section (stars, "4.5 out of 5 · 2 reviews", the latest reviews, **Report** per review with an inline form; `reviewReport`: 10 per device per 10 min). **JSON-LD `aggregateRating` only from 3 visible reviews** (`MIN_REVIEWS_FOR_RATING`, pending owner). Cached under the org's tag; submissions and moderation revalidate it.
- **Console** event nav **Reviews** (`/o/{org}/e/{event}/reviews`): average and visible count, filters, each review with its reports; Hide / Show with a reason, Dismiss reports. Viewers see a read-only note and no controls; a stale form is refused.

### Migration `0050_common_stardust.sql` (renumber on merge)
- New schemas `cms` (`entries`) and `reviews` (`reviews`, `review_reports`): tenantTable, ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FK `review_reports → reviews`.
- Existing table: `marketplace.site_settings.nav_page_ids uuid[] NOT NULL DEFAULT '{}'` (metadata-only).
- **Hand edits** (between `-- hand-written: begin/end`): (1) `site_settings_nav_page_ids_check` added `NOT VALID` then `VALIDATE`; (2) `entries_org_fk`, `reviews_org_fk`, `review_reports_org_fk` → `tenancy.organizations` (cascade); (3) cross-module composite FKs `reviews_event_fk` → `events.events (org_id, id)` and `reviews_order_fk` → `orders.orders (org_id, id)` (cascade; new tables, so no `NOT VALID` needed).

### Later / not yet (M1.4g)
- Cover images and inline images in posts (M1.4e media pipeline); rich-text editing beyond the Markdown subset; scheduled publishing; revisions; per-locale translations of a post.
- A per-event "show reviews" switch (legacy `show_reviews`, mapped at ELT) and organizer-level ratings on the organizer page (legacy profile ratings); a buyer editing or deleting their review; reviews from signed-in accounts without the manage link (no buyer account area exists yet); organizer replies; a "verified attendee" badge from check-ins.
- **DSAR** coverage of reviews: `privacy` is tier 5 like `reviews`, so its export/erase can't import it; it needs a port registered in the composition root. Reviews hold no email (only a per-org hash and "First L."), so erasure by email needs that hash computed there. Legacy reviews and posts are imported by the ELT (M2.x).
- `/v1` endpoints for CMS and reviews; notifications to the organizer on new reviews and reports (M1.10 subscribes to `review.submitted@1` / `review.reported@1`).
- The marketplace sitemap covers organizer content only for organizers with listings (it has no cross-tenant CMS index); a SECURITY DEFINER sitemap function comes with the content org at ELT if needed.

### Acceptance (M1.4g)
| ID | Criterion | Test |
|---|---|---|
| G1 | Slug rules (derive, suffix, validation, frozen after publish), sanitizer on CMS bodies, input schemas | `packages/modules/cms/tests/slug.test.ts`, `packages/testing/tests/cms.int.test.ts` |
| G2 | CMS lifecycle: drafts/archived are 404 publicly, publish keeps the first date, unpublish, delete; allowlisted public DTO | `cms.int.test.ts`, `apps/web/e2e/cms.spec.ts` |
| G3 | CMS permissions: viewers read only (hidden controls, `/content/new` refused, stale form refused), marketing writes, another org can't read or change | `cms.int.test.ts`, `cms.spec.ts` |
| G4 | Audit on every CMS write; `cms.post_published@1` etc. in the outbox | `cms.int.test.ts` |
| G5 | Public render on tenant site, organizer page and marketplace `/blogs`; blog index; sanitized Markdown; JSON-LD `BlogPosting` valid; canonical + 13 hreflang + x-default; sitemap entry added on publish and removed on unpublish; keyboard delete with confirmation; axe; Arabic RTL; no horizontal scroll at 375 | `cms.spec.ts`, `apps/web/tests/cms-seo.test.ts` |
| G6 | Tenant-site navigation links this org's pages only (drafts hidden until published); persists | `cms.int.test.ts`, `cms.spec.ts` |
| G7 | Eligibility: not ended (instant, UTC-day trap), window closes at the local day boundary (Honolulu, DST), multi-date, no ticket, not held, already reviewed; "First L." | `packages/modules/reviews/tests/eligibility.test.ts` |
| G8 | One review per holder under concurrency and across two orders; unknown tokens and other orgs refused; no email stored or shown | `packages/testing/tests/reviews.int.test.ts` |
| G9 | Moderation: hide/unhide need a reason, audited with it, `review.hidden@1`; viewers read only; other org refused; reports once per device, dismiss, hiding actions them | `reviews.int.test.ts`, `apps/web/e2e/reviews.spec.ts` |
| G10 | In the browser: future event refused with the opening date; past event allowed; validation; keyboard rating; duplicate refused from a stale tab; public aggregate and JSON-LD `aggregateRating` only from 3; report; hide removes it from the aggregate; viewer denied; axe on every state; Arabic RTL | `reviews.spec.ts`, `cms-seo.test.ts` |
| G11 | Isolation: every new tenant table has rows for both fixture orgs; RLS FORCE | `packages/testing/tests/isolation.int.test.ts` |
