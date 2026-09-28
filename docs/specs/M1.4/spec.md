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
- **M1.4e:** media pipeline (R2 + re-encode, SVG neutralized): **done behind a storage port, see below** (R2 itself waits for the owner's Cloudflare account). Tenant CMS and reviews move to a later increment.
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

## M1.4e — media pipeline: uploads, images and SVG safety (done, R2 behind a port)
**Risk tags:** `db-migration`, `tenancy`, `infra` (owner approval). Migration `0046_amusing_toro.sql` (renumber on merge).

**Module `media` (tier 3, schema `media`, `packages/modules/media`).** Tier 3 so it can check owners through the public exports of `events` (2), `venues` (1) and `tenancy` (1); nothing below it imports it.
- **Tables** (all `tenantTable`, ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs):
  - `media.assets`: owner (`event` | `venue` | `org`), owner id, slot (`cover`, `gallery` for events; `photo` for venues; `logo` for the org, whose owner id must be the org), position, sniffed source type, width/height, alt text, `decorative`, stored bytes, uploader. CHECKs: owner/slot pairs, **alt required unless decorative** (1–300 characters), dimensions. A partial unique index keeps one `cover` / `logo` per owner.
  - `media.variants`: format (`avif`, `webp`, `jpeg`, `png`, `svg`), width/height, bytes, SHA-256, file name `{width}-{sha256[:32]}.{ext}`, `fallback`; composite FK to its asset, `ON DELETE CASCADE`.
  - `media.blobs`: the **Postgres storage adapter's** objects (dev, preview, CI); a CHECK keeps every key under `{org}/`.
  - `media.quotas`: per-org quota override (default 1 GiB, pending owner).
- **Storage port** (`MediaStore`: `put`, `get`, `deleteAsset`), keys `{org}/{asset}/{file}`; every call names the org and refuses a key outside its prefix (and any path trick):
  - `postgres` (default outside production): `media.blobs` in its own short tenant transaction under RLS, like a remote store.
  - `r2`: Cloudflare R2's S3 API signed with **AWS Signature V4** (region `auto`), implemented on `fetch` + `node:crypto` (no SDK). Checked against AWS's published SigV4 test vector and a stub `fetch`; **never called in tests**. `MEDIA_STORE=r2` + `R2_*` (`.env.example`); production refuses the Postgres store. Owner inbox: R2.
- **Pipeline** (`src/pipeline/*`, pure and unit-tested):
  - **Sniffing** by magic bytes only (JPEG, PNG, GIF, WebP, AVIF by its `ftyp` brand, SVG as UTF-8 text whose first element is `<svg`); the file name and Content-Type are never trusted.
  - **Limits:** 4 MB per upload (Vercel's 4.5 MB request cap; SVG 1 MB), 40 megapixels (`limitInputPixels`, checked on the header so a decompression bomb is refused before decoding).
  - **Re-encode with `sharp` 0.35 (libvips 8.18):** first frame only, auto-oriented from EXIF, AVIF + WebP at 320/640/1280/1920 below the source width plus the source width (capped, never enlarged), and one PNG (transparency, SVG) or JPEG fallback ≤1280 px for email and OG images. The encoders write no metadata: EXIF (GPS, camera serials), XMP, IPTC and ICC never reach a variant (tested with a GPS-tagged JPEG).
  - **SVG: sanitize, then serve with a sandboxing CSP** (both, not either). The sanitizer is a small strict XML tokenizer that never expands entities (the DOCTYPE is discarded; `&lol9;` becomes nothing) and rebuilds the document from an element/attribute allowlist: no `script`, `foreignObject`, animation (`set`/`animate*` can rewrite `href`), `feImage`, `iframe`/`object`/`embed`/`handler`, `on*` handlers, `href`/`xlink:href` other than a local `#id` (an `<image>` may carry a `data:` PNG/JPEG/GIF/WebP), CSS `url()` other than `#id`, `@import`/`@font-face`, processing instructions, or any attribute value with a URL scheme after whitespace/control characters are removed. Output is re-serialized with escaping. Rasters are made from the **sanitized** document only. *Why both:* the vector keeps logos crisp and small; the sanitizer makes the file inert anywhere it ends up (downloads, other clients), and the CSP (`default-src 'none'; style-src 'unsafe-inline'; sandbox`) plus `nosniff` protect even if the sanitizer ever missed something. Raster-only would lose vector logos and still need a sanitizer before rasterizing (librsvg follows external references).
  - Processing runs inside the command's transaction, after authorization (a viewer's upload is refused before any decoding). The roadmap's worker re-encode is Later (see below).
- **Commands** (10-step pipeline via `tenantCommand`, audited, outbox events `media.asset_added@1` / `media.asset_removed@1`): `media.uploadMedia` / `removeMedia` / `updateMediaAlt` (`events:write`: event and venue images) and `media.uploadLogo` / `removeLogo` / `updateLogoAlt` (`org:update`; a logo is never decorative). Each family refuses the other's assets. Uploads check the owner exists **under the org's RLS** (another org's event id is `not_found`), the slot (one cover/logo, which a new upload replaces; ≤20 gallery images/venue photos, `slot_full`), and the **quota** under a per-org advisory lock (a replacement's old bytes don't count twice; `quota_exceeded`). Wrappers `uploadMedia`/`uploadLogo`/`removeMedia` purge files after commit: a replaced/removed asset's `{org}/{asset}/` prefix, or a failed upload's own (the asset id is always generated server-side, so a purge never hits a live image).
- **Queries:** `media.listMedia`, `media.usage` (`org:read`: every member may look).
- **Public reads** (SECURITY DEFINER, allowlisted `PublicMediaDto`, no byte counts/uploader/source type): `media.owner_visibility(org, type, id)` → `public` (published/postponed/cancelled/completed public or unlisted events; listed, live venues; the logo of an active/limited org), `private_event` (a live private event: only with an access grant the server checked) or `none`; `media.public_media(type, id, private_ok)`, `media.public_covers(slugs[])` (listing cards, ≤500), `media.serve_target(org, asset, file)` (metadata only).
- **Org logo on tenancy** (existing table, expand step): `tenancy.organizations.logo_path` + `logo_alt` (the fallback variant's `/media/…` path, CHECKed), set only through tenancy's new `setOrganizationLogoTx` from the logo commands; `organizationBrandTx` / `organizationPublicTx` return them. Emails render the logo from the absolute URL (`appOrigin` + path) with its alt text.

**Web (`apps/web`).**
- **Upload:** `POST /api/media/upload` (multipart). The console page signs an **upload ticket** (HMAC with `APP_TOKEN_SECRET`: org, owner, slot, user, 1 h expiry) only for people who may change those images; the endpoint caps `Content-Length` before reading, needs the session user to be the ticket's user, and runs the command, which authorizes on its own (a ticket never grants a permission). Errors return the code, reason and field.
- **Serving:** `GET /media/{org}/{asset}/{width}-{hash}.{ext}` on the app origin (so the strict CSP `img-src 'self' data: blob:` holds; `proxy.ts` skips `/media/`). Public owners: `Cache-Control: public, max-age=31536000, immutable`, `Cross-Origin-Resource-Policy: cross-origin` (email clients). Otherwise only a visitor with the event's access grant or a **member of that org** gets it (`private, …`, `Vary: Cookie`, CORP same-origin); anyone else — another org's owner included — gets the same 404 as a missing file. Every response: ETag = SHA-256, `nosniff`, `default-src 'none'; style-src 'unsafe-inline'; sandbox`, `Referrer-Policy: no-referrer`.
- **Uploader** (`MediaUploader`, client): a real, labelled file input (keyboard and screen readers; dropping a file on the zone is optional sugar), alt text with hint, "decorative" checkbox (not for logos), client checks mirrored from the module (type, 4 MB, alt; `tests/media-limits.test.ts` keeps them equal) and the server's reasons shown on the field (`aria-invalid`, focus moves to it), a `<progress>` bar from XHR upload progress with a live status ("Uploading… 40 %", "Processing the image…", "Image uploaded."), and per image: preview with its alt, **Replace** (in place, gallery keeps its position), **Remove**, **Edit alt text** (Server Actions). Viewers see the images and a notice, no controls.
- **Console:** event **Images** page (`/o/{org}/e/{event}/media`, nav item `media` in every profile): cover + gallery. **Settings → Logo** (owners/admins; the logo shows in the console's org switcher). **Venue page → Venue photos.**
- **Public:** event hero (cover, dimmed under white text) and **Gallery** section (also on tenant sites, and for a private event once a code opened it); listing cards (cover thumbnail, one `public_covers` query per page); `og:image`/JSON-LD image = the cover's JPEG/PNG fallback (absolute) when there is one, else the generated card; org page `/o/{slug}` and tenant site hero (logo on a white tile); public venue page **Photos**. `<picture>` with AVIF → WebP → fallback `srcset`s, width/height attributes (no inline styles), lazy loading.
- Messages: `media.*`, `eventMedia.*`, `nav.media`, `publicEvent.gallery`, `venuePage.photos` in 13 locales (Arabic zero/one/two/few/many/other, Russian one/few/many/other).

### Golden transforms (roadmap acceptance "Blob transforms pass the golden queries")
`packages/modules/media/fixtures/` holds tiny synthetic, license-free images made by `scripts/make-fixtures.ts` from arithmetic patterns (a 2000×500 PNG banner, a 640×480 JPEG with EXIF GPS and orientation 6, a 300×300 PNG with alpha, a GIF, a WebP, an AVIF, an SVG logo with DOCTYPE/gradient/`<use>`), refused inputs (a PNG header claiming 20000×20000, text named `.png`, broken SVG, HTML named `.svg`) and the **malicious SVG corpus** (script, CDATA script, uppercase/namespaced script, `onload`/`onclick`, `xlink:href="javascript:"` incl. entity-encoded, external `<use>`/`<image>`/`feImage`, `foreignObject` with iframe, entity expansion + XXE, `set`/`animate` href, CSS `@import`/`url()` exfiltration, `xml-stylesheet`, iframe/embed/object/handler). `fixtures/golden.json` records every variant's format, dimensions, fallback flag and SHA-256; the test fails on any change (regenerate on purpose with `pnpm --filter @yayatoh/media golden:update` and review the diff, e.g. after a sharp upgrade). Output was verified deterministic across runs.

### Legacy images → media rows (mapping for the M2.2b ELT; not built here)
The legacy app (Eventmie Pro + custom code) stores **paths relative to its storage disk** (`public` → served at `https://{host}/storage/{path}`, or `s3` → the bucket URL), written by `upload_base64_image` / Laravel `store`: `events/{MonthYYYY}/{name}.{ext}` and similar. The media files arrive in R2 under `legacy/{instance}/…` by `rclone copy --checksum` (roadmap §7.4); `/storage/*` stays redirected for ≥24 months.

| Legacy source | Target | Notes |
|---|---|---|
| `events.poster` (16:9 banner, 1280×720 crop) | `media.assets` owner `event`, slot `cover` | The legacy hero. Alt text: none exists → `alt = event title` (non-decorative), flagged `needs_review` in the ELT report. |
| `events.thumbnail` (512×512 square) | cover **only if `poster` is empty**; otherwise dropped (the new pipeline derives card thumbnails from the cover) | Kept in the R2 legacy prefix for the `/storage/*` redirect. |
| `events.images` (JSON array of paths) | slot `gallery`, `position` = array index | Invalid JSON / non-array → quarantine row; >20 images → first 20, rest reported. Alt = `"{event title} – photo {n}"`, `needs_review`. |
| `events.seatingchart_image` | not media: floor-plan background (M1.7 import) | Out of scope here. |
| `venues.images` (JSON array) | owner `venue`, slot `photo`, position = index | Same JSON rules as `events.images`; venue via the M2.2 venue id map. |
| Voyager `settings` `site.logo` (per instance: yayatoh, ABC) | owner `org`, slot `logo` of the instance's migrated org; `alt = org name` | Sets `tenancy.organizations.logo_path/logo_alt` through the same command path. |
| `users.avatar` (organizer profile pictures) | not migrated in M1.4e (no user avatars yet) | Listed for M2.2 decision; kept in R2 legacy prefix. |
| `session_thumbnails/…`, `EventSpeaker.avatar`, `EventExhibitor.logo`/team avatars | owners from M1.4f (sessions, speakers, exhibitors) | Mapping added with M1.4f. |

Rules for every row: fetch the object from the R2 legacy prefix (or S3 when the legacy disk was `s3`; absolute `http(s)` values are external and are **not** fetched: reported), run the **same pipeline** (sniff, sanitize SVG, re-encode, EXIF strip) through the commands with a system actor (`system:elt`, audited), so a legacy SVG with script is neutralized like any upload; unsupported or undecodable files and missing objects are quarantined with the legacy table/id/path; per-org quota checks are skipped for the backfill (reported instead); idempotent by `(instance, legacy table, legacy id, path)` in the ELT's own mapping table so re-runs replace nothing twice; `legacy_redirects` gets `/storage/{path}` → the new fallback variant for every migrated image (M1.11).

### Migration `0046_amusing_toro.sql`
- New schema `media` with `assets`, `variants`, `blobs`, `quotas` (FORCE RLS, NULLIF policies, org-leading indexes, `variants_asset_fk` composite FK).
- Existing table (nullable columns only): `tenancy.organizations.logo_path`, `logo_alt`.
- Hand-written (between `-- hand-written: begin/end`):
  1. `organizations_logo_check` added `NOT VALID`, then `VALIDATE CONSTRAINT` (every existing row has no logo).
  2. SECURITY DEFINER functions `media.owner_visibility(uuid, text, uuid)`, `media.public_media(text, uuid, boolean)`, `media.public_covers(text[])`, `media.serve_target(uuid, uuid, text)`, each with `REVOKE ALL … FROM PUBLIC` and `GRANT EXECUTE … TO app_user`. They read `tenancy.organizations`, `events.events` and `venues.venues` for visibility only (as the M1.4d public functions do).

### Later / not yet (M1.4e)
- **Re-encoding in the worker** (roadmap §2, research 22 "isolated worker"): today it runs in the upload request after authorization. Moving it to a pg-boss job needs a "processing" state and polling in the uploader.
- **Direct-to-R2 uploads** (presigned PUT in the upload ticket's shape) to lift the 4 MB cap; a sweeper for orphaned objects (a crash between the store write and commit); CDN purge by tag when a public image is removed or its event unpublished (public responses are cached for a year today).
- Staff screen for quotas; per-event storage caps (M4.5 guest galleries); image focal point/cropping; gallery reordering (drag with Move up/down, as in M1.4d); captions; video (Cloudflare Stream, D19).
- Emails: the template preview in the console does not show the logo yet (the real send does). Legacy image ELT (mapping above) in M2.2b. User avatars.
- Tenant CMS and reviews (the rest of the original M1.4e line).

## Acceptance (M1.4e)
| ID | Criterion | Test |
|---|---|---|
| E1 | Sniffing by magic bytes (never name/header); AVIF brands; SVG text rules | `media/tests/sniff.test.ts` |
| E2 | **An SVG with script is neutralized**: the whole malicious corpus comes out inert (and rasterizes); safe SVGs keep gradients/`<use>`; malformed/too-complex refused; CSS sanitizer | `media/tests/svg.test.ts` |
| E3 | Variant planning: standard widths, never enlarged, fallback choice, file names | `media/tests/plan.test.ts` |
| E4 | **Blob transforms pass the golden queries**: every fixture → recorded formats, dimensions and SHA-256; EXIF/GPS stripped with orientation applied; bombs, text-as-PNG, oversize and truncated files refused | `media/tests/golden.test.ts` |
| E5 | Storage port: org-prefixed keys only; R2 SigV4 matches AWS's test vector; the R2 adapter signs every call and never leaves the stub; env selection, production refuses Postgres; upload tickets verify, expire and resist tampering | `media/tests/storage.test.ts`, `media/tests/ticket.test.ts`, `apps/web/tests/media-limits.test.ts` |
| E6 | Commands: upload/replace (cover single, gallery in place, ≤20), alt required unless decorative, SVG stored sanitized, slot/owner rules; viewer refused, manager can't touch the logo, families separated | `testing/tests/media.int.test.ts` |
| E7 | Quota under a lock; a failed upload leaves no files; replacement not double-counted; per org | `media.int.test.ts` |
| E8 | Isolation: another org can't list, change, remove or attach; the store refuses cross-org keys; fixture rows for both orgs | `media.int.test.ts`, `testing/tests/isolation.int.test.ts` |
| E9 | Serve permissions: event images public only with a public page, private events only with a grant, venue photos only listed/live, logo of active orgs; unknown/mismatched files resolve to nothing | `media.int.test.ts`, `e2e/media.spec.ts` |
| E10 | Deletion removes rows, variants and files; the URLs stop serving; the logo reference clears | `media.int.test.ts`, `e2e/media.spec.ts` |
| E11 | UI: cover validation errors (no file, wrong type by name and by bytes, too big, missing alt), keyboard-only upload, persistence, public hero + listing card + og:image, replace and remove, gallery (decorative, replace in place), malicious SVG served inert (headers + body, no dialog), viewer: no controls + refused endpoint + other org 404, org logo (console, org page, tenant site, replace, remove), venue photos (public page, unlisting hides them), axe on every new screen/state, Arabic RTL, 375 layout | `e2e/media.spec.ts` |
| E12 | Email header shows the logo from its absolute URL with alt; relative/script URLs never render | `notifications/tests/render.test.ts` |

