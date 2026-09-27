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

## Remaining M1.4 increments
- **M1.4b:** occurrences (multi-day and recurring), event series, templates and duplicate-as-template (never copies orders).
- **M1.4c:** venues (directory, org-owned, quote requests), categories and tags. **Done, see below.**
- **M1.4d:** content sections, announcements, the private-info portal, access codes, short URLs, online events. **Done, see below.**
- **M1.4e:** media pipeline (R2 + re-encode, SVG neutralized; blocked on the owner's Cloudflare account), tenant CMS, reviews.
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
