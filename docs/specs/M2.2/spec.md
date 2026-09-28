# M2.2 — Migration completeness

Roadmap M2.2: "Transforms T1–T9 at 100%; user dedupe; affiliates; series inference; media. Acceptance: V1–V12 pass for both instances; full run ≤60 min." Ground rules §7.1: extraction from backups or a replica; production dumps only in the encrypted `legacy-ref` environment; development uses a deterministic masked dataset built with keyed hashes that keeps duplicate structure intact.

## M2.2a — legacy export and masking tool (done)

`tools/legacy-mask` (no dependencies; plain Node 24 or Docker) and `docs/runbooks/legacy-export.md`. The owner runs it next to the production dump; only the masked file leaves that machine.

- **Reader/writer:** a streaming mysqldump parser (statements split across any chunk size; strings with `;`, `),(`, escapes, emoji; `NULL`, numbers, `0x…` hex, `_binary`; `CREATE TABLE` columns with lengths, nullability and unique keys; extended and `--complete-insert` INSERTs). Values are written back with MySQL's escaping; `.sql.gz` in and out.
- **Masking:** keyed HMAC-SHA256 (a 32-byte key the owner keeps), so the same person masks to the same values in every table and every later dump, and nobody without the key can link them back. Strategies: email, first/last/full name, phone (E.164 `+1555…`), street, postcode, IP (documentation ranges), user agent, token (same length and alphabet), provider reference (prefix kept), text (placeholder of similar length), password (bcrypt of `password`), image path, birth date (year kept), JSON (personal keys) and JSON-all (every value), empty JSON (card data), contact (email or street), email-or-reference, last four (`4242`).
- **Rules:** `src/rules.ts` covers the 70 legacy tables from the migrations' column inventory: users (incl. bank/tax/seller fields, tokens, Stripe ids), bookings, attendees (`address` holds emails), transactions, failed bookings (raw card data emptied), events' private info, notifications (plain-text guest passwords), guests, newsletter, contacts, messages, reviews, reports, exhibitors, event codes, Voyager settings (secret keys by name; contact email/phone/address). Sessions, password resets, OTPs, cache, jobs and webhook logs are emptied. Columns without a rule fall back to name heuristics (text and binary columns), and every email anywhere in kept text is swapped for its masked twin.
- **Never breaks the import:** ids, foreign keys, amounts, currencies, dates, statuses and public event content are unchanged; unique columns stay unique (collisions re-drawn); NOT NULL columns are never set to NULL; values fit their column length; JSON stays valid JSON; the output is valid SQL that loads into MySQL 8 with the same row counts.
- **Fail-closed:** rows of a table without a definition are omitted and reported; the report holds names and counts only; `verify` rejects any surviving original email or masked-column value, a lost row or a duplicate key.

### Acceptance (M2.2a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The reader splits statements identically at any chunk size and round-trips every value kind | `tools/legacy-mask/tests/sql.test.ts` |
| AC2 | No original email, card number, code, key, token, bank detail, IP or name survives; secrets in settings replaced; card data emptied; credential tables emptied | `tools/legacy-mask/tests/mask.test.ts` |
| AC3 | Ids, amounts and dates unchanged; one person keeps one identity across tables; values pass the new product's email/E.164/JSON/bcrypt/length checks; NOT NULL respected | `mask.test.ts` |
| AC4 | Unique columns stay unique across 20,000 rows with forced collisions; deterministic per key; fail-closed on unknown tables; the verifier catches leaks, lost rows and duplicates | `mask.test.ts` |
| AC5 | The CLI: private key file, no overwrites, gzip in/out, verify exit codes | `tools/legacy-mask/tests/cli.test.ts` |
| AC6 | The masked dump loads into MySQL 8 with every row count equal (emptied tables empty) and valid JSON | CI job `legacy mask` (`tools/legacy-mask/scripts/import-check.sh`) |

### Legacy findings (for M0.0)
- `failed_bookings.payment_method` stores full card numbers, expiry, CVC and cardholder name for failed checkouts (legacy BookingsController); session payloads can carry the same. Storing CVCs is forbidden by PCI DSS.
- `notifications.data` and queued jobs hold generated guest passwords in plain text.
- `events.private_info` holds Wi-Fi passwords, parking and door codes.

## M2.2b — the legacy ELT, built and proven on synthetic data (done)

Roadmap §7.5 (pipeline, ids, T1–T9, time, legacy QR, Stripe, audit-derived specifics, V1–V12) and §7.1. No real legacy data exists in development and none was used: everything is proven on **synthetic** legacy dumps generated for this purpose. The owner runs the same pipeline on the masked dumps from M2.2a (`docs/runbooks/legacy-migration.md`).

**Legacy schema source.** The 70 legacy tables were read from the reference repo (`heywebbuddy/yayatoh-legacy`: `database/migrations` and `eventmie-pro/publishable/database/migrations`, consolidated in timestamp order) and the legacy code, for behaviour only. Nothing was copied.

### Where it lives, and who writes
- **`tools/legacy-migrate`** (`@yayatoh/legacy-migrate`): the generator, the loader, the transforms, code issuing, validation and the CLI.
  - `pnpm migrate:legacy --instance=yay|abc --mode=rehearsal|cutover --dump <file>`
  - `pnpm migrate:legacy:validate --instance=…`
  - `pnpm migrate:legacy:synth --instance=… --scale=small|demo|large --out <file>`
  - `pnpm migrate:legacy:demo` (the e2e dataset)
- **Decision: set-based SQL as `migrator`, not the modules' commands.** Justification, within CLAUDE.md's rules:
  - A data migration is a migration. The roadmap specifies "versioned idempotent SQL transforms" run by the same role that owns the schema.
  - Replaying 200k+ bookings through `executeCommand` would take hours. It would also emit live domain events: order emails and journeys. Backfilled events must be `replayed=true` (T9, Later).
  - The rules that matter hold anyway:
    - Every migrated row is written with its `org_id`.
    - RLS stays ENABLE + FORCE on every tenant table. V11 checks this after every run.
    - No module imports another module's schema; the tool imports only public exports (`managedHostname`, `hashManageToken`, `keyVault`, `signTicketCode`).
    - Codes and tokens are issued exactly as the ticketing and orders modules do: per-org Ed25519 keys and KeyVault envelopes.
- **`@yayatoh/db/migration`** (`migratorSql()`) is a new restricted entry point. check-modules only lets `tools/legacy-migrate` import it (rule `migrator-access`, canary `migrator-access`). The tool refuses to run as any role but `migrator`.
- **Platform-owned schemas the tool creates at runtime.** They are not tenant tables and are not in drizzle.
  - `legacy_yay` / `legacy_abc`: staging. They hold the raw legacy rows, kept for 12 months.
  - `legacy`: control. It holds:
    - `runs`
    - `ref`: legacy id ↔ new id per instance, with `compat_id`
    - `quarantine` and `exceptions`
    - `credentials`
    - `venue_tz`, `instance_settings`, `meta`
    - the SQL twins of the id, email, short-code and time rules
  - `app_user` and `platform_reader` have no privileges on any of them. `grantSchemaUsage` now skips `legacy` and `legacy_*`, and the tool revokes table privileges explicitly. V11 probes this as `app_user`.

### Synthetic legacy generator
- Deterministic and seedable: the same options give byte-identical dumps.
- mysqldump format, one dump per instance (`yay`, `abc`). Each is marked `SYNTHETIC TEST DATA ONLY`, and every email uses a reserved example domain (a test enforces both).
- 18 tables with their legacy column names and types: users, roles, user_roles, settings, countries, categories, events, schedules, serverside_dates, tickets, promocodes, ticket_promocode, transactions, bookings, commissions, attendees, checkins, pages.
- Realistic shapes:
  - Organizers, with POS, scanner and manager sub-accounts (`organizer_id`, per-event `user_roles`).
  - Events with inline venues across several US states. Some are weekly repetitive, with `schedules` and `serverside_dates`.
  - Donation tickets and sale prices.
  - Bookings grouped by `common_order`: one row per person, or one distributable row with quantity N plus hand-on child bookings.
  - Attendees whose email sits in `address`, including a few invalid values (`N/A`).
  - Transactions through Stripe, Stripe Direct (connected organizers), PayPal and offline, including unpaid offline rows.
  - Commissions, settled and unsettled (transferred / settled flags).
  - Check-ins per booking per day, with the day in platform time and the time of day in UTC, plus an occasional duplicate row.
  - Promo codes (fixed and percent).
  - Cancellations and refunds on a fixed rhythm: requested, approved, refunded, and one refunded row inside a multi-row order.
  - Disabled rows.
- Planted edge cases:
  - Users sharing an email across instances, with case and whitespace variants.
  - An unverified, never-paying abc twin (for the pre-hijack guard).
  - Duplicated `order_number`s within an instance.
  - DST fold and gap start times.
  - Invalid JSON in content columns (`events.images`, `users.social_links`, at most 1 in 400 rows).
- The abc instance has the admin-run ABC flagship events plus affiliate organizers.
- Scales:
  - `small`: tests, a few hundred bookings.
  - `demo`: e2e, plus the fixed "Lakeshore Jazz Society" org with a live weekly series and a past gala.
  - `large`: timed runs, about 4,900 events and 296,000 booking rows.

### Load (roadmap §7.5 step 2)
- Streams the dump through legacy-mask's reader (any size, `.sql` or `.sql.gz`) instead of pgloader, and COPYs into `legacy_{inst}`. The staging schema is recreated on each load.
- Type rules:
  - DATETIME/TIMESTAMP → `timestamp without time zone`
  - `tinyint(1)` (and every tinyint) → smallint
  - unsigned and all other integers → bigint
  - decimal → numeric
  - text, enum and set → text
  - zero dates → null
- Values a column cannot hold load as null and go to quarantine: non-JSON in a JSON column, impossible dates, a TIME past 24 h, unparsable numbers.
- JSON kept in text columns is checked later with `legacy.try_jsonb()`.
- Also recorded: indexes on id, `*_id`, `common_order` and `order_number`; the dump's SHA-256; and per-table row counts.

### Ids
- A migrated row's id is a **deterministic UUIDv7**:
  - The 48-bit timestamp is the legacy `created_at`.
  - The other bits come from SHA-256 of `instance|table|legacy_id`.
  - `src/ids.ts detUuid`, twin `legacy.det_uuid()`. A test keeps the two equal.
- `legacy.ref` maps every legacy id per instance to its new id, with `compat_id` = the legacy integer id where the old apps use one (bookings → their ticket).
- Every insert conflicts on the id and does nothing, so **a rerun gives identical ids and no duplicates** (test: a fingerprint of every migrated table before and after a rerun).

### T1 Identity
- The merge key is `lower(nfkc(trim(email)))`. It is trimmed again after NFKC, because NFKC turns Unicode spaces into ASCII spaces.
- The result is one global `auth.users` row per email, across both instances and any existing (beta) account.
  - The id is derived from the email, so it is the same whichever instance creates it.
  - An existing account is never overwritten.
- Every legacy bcrypt hash is kept in `legacy.credentials`. The primary hash goes to `auth.accounts`. Laravel `$2y$` hashes verify, and are rehashed to Argon2id on first sign-in; this was already built.
- **Pre-hijack guard.** In a merged identity (several legacy accounts, or a beta account), a credential from an account that never verified its email and never paid is not carried. If no merged account qualifies, no legacy credential is kept (exception `credential_skipped_prehijack`).
- A password set on the new platform (Argon2id) always wins.
- No platform staff come from legacy data. Legacy admins are listed as exceptions; abc admins become ABC org admins.
- Soft-deleted accounts and non-email addresses are not migrated as users (exceptions). Their bookings still migrate.

### T2 Orgs
- Each organizer becomes an org, with:
  - `legacy_instance` set
  - an owner membership
  - the tenant-apex subdomain every org gets
  - a slug from the organisation name, or `-{inst}-{id}` when taken
- Sub-accounts become memberships:
  - POS → `box_office`
  - Scanner → `scanner`
  - Manager → `manager`
- Their per-event `user_roles` become event roles: Scanner → `door_staff`, Manager → `event_manager`.
- The abc instance becomes the parent **ABC** org (slug `abc`):
  - Its admins become ABC admins; the earliest is the owner (pending owner).
  - It owns `abc.yayatoh.com`, added as `pending_dns`; staff activate it at the B-A cutover.
  - Each other abc organizer is a `host_affiliate` child (new `tenancy.org_relationships`).
- Connected Stripe accounts (`acct_…`) carry over as `payments.payment_accounts` (`standard`), with charges and payouts off until they are refreshed from Stripe at cutover.

### T3 catalog (the part commerce needs)
- **Events.**
  - The instant is the stored wall clock read in the **platform timezone**. The legacy app converted organizer input to `regional.timezone_default` before saving; see `serverTimezone()` in the legacy helpers.
  - The event's IANA timezone, which it renders in, comes from the venue's country and state (`legacy.venue_tz`; platform zone fallback listed as an exception).
  - `--event-clock=venue` reads wall clocks as venue-local instead (pending owner, below).
  - A repetitive event spans its first to last date.
  - DST folds and gaps are logged.
  - An end at or before the start becomes start + 3 h (exception).
  - An event whose owner is not an organizer goes to a per-instance holding org (`legacy-{inst}-unassigned`, status limited) and the exceptions report. It is never dropped.
  - Slugs keep the legacy slug when free, else `-{inst}-{id}`.
  - Status: published when `publish` and `status` are set, else draft. `is_private` → unlisted.
- **Ticket types:**
  - price
  - capacity, raised to what was sold
  - sold = migrated active tickets
  - visibility
  - sort order
  - per-order limit
  - donation flag
  - `sale_price` + `sale_end_date` → early price
  - `access_dates` → the new shape
- **Event roles** for assigned sub-accounts.
- **Promo codes.** Legacy codes are organizer-wide and globally unique; the new ones are per event. There is one per (code, event) that its tickets link to or its bookings used. The code is sanitized to `^[A-Z0-9_-]{3,32}$`, and redemptions carry over.

### T4 Commerce
- **Orders.** An order is the bookings of one `(instance, common_order)`, and defensively one event and buyer. Code reading showed that `common_order` is the checkout key (it equals `transactions.order_number`), while `bookings.order_number` is each row's QR payload. Hand-on rows (`distributed_from_booking_id`) are not new tickets: they move one unit of the parent to its new holder, and the child booking's id maps to that ticket.
- **Money is exact to the cent.** Per row:
  - face = `price`
  - discount = `promocode_reward`
  - fee added on top = `net_price − price + reward` (the "excluding" taxes)
  - all-in = `net_price`
  - organizer net = the commission's `organiser_earning`
  - Order total = Σ net, subtotal = total − fee.
  - A quantity-N row that does not divide evenly becomes N−1 units at the floor plus one unit carrying the remainder (`src/money.ts`, twin in SQL).
- **Status:**
  - every row refunded (`booking_cancel = 3`) → refunded
  - some rows refunded → partially_refunded
  - every row cancelled (2 or 3) → cancelled
  - an unpaid offline row → awaiting_payment
  - otherwise paid
  - Tickets are void when their row was refunded, cancelled, disabled or unpaid (`void_reason`).
  - Refunds become succeeded `orders.refunds` with their tickets.
- **Payments** keep `orders.charge_model` (new column):
  - Stripe → `legacy_platform`
  - Stripe Direct → `legacy_direct_connected`, as `organizer_mor` on the organizer's connected account
  - PayPal → `paypal`
  - none or Offline → `offline`, collected by the organizer
  - The gateway reference is kept. A repeated one is kept as the payment reference and listed.
  - `created_via = 'legacy'`, and a fee-schedule snapshot records the legacy commission %.
- **Tickets:**
  - one per unit
  - serials per event in purchase order
  - short codes derived from the ticket id, re-salted on the rare per-org collision
  - holders: from the hand-on, else the attendee row, else the buyer
- **Attendees and contacts.** One attendee per ticket. The email in `attendees.address` becomes the contact email when valid, else the buyer's. Org contacts are keyed by normalized email (source `legacy`).
- **Commissions** become `payments.legacy_settlements` (new tenant table):
  - an `event_statement` per org × event × currency (paid, commission, admin tax, earning, transferred, open, clawback)
  - an **opening balance** per org × currency for what was still owed, status `pending_signoff`, never released without the owner's sign-off
- **Codes and links:**
  - Every migrated ticket gets its org's signed yy1 code. The org's first signing key is created here, KeyVault-encrypted.
  - The legacy QR payload (the row's `order_number`) is kept as an active `legacy_eventmie` barcode, unique per (org, payload). A payload repeated within the instance is not attached (it could admit the wrong person) and goes to owner review.
  - Every migrated order gets a manage token: random, stored only as its hash and its KeyVault envelope.

### T5 check-ins
- Each legacy `checkins` row (one booking, one day) becomes, for each ticket it covers, an **admission** (the check-in state; one per ticket per event day in the event's timezone) and a **scan** with `code_kind = 'legacy'`. The legacy import dedupe key is `legacy:{inst}:{checkin}:{ticket}`.
- The instant is the UTC time of day on whichever UTC date falls on the regional scan day (`legacy.checkin_instant`).
- Duplicate legacy rows collapse.

### Scanner and order page
- `checkin.scanTicket` resolves a legacy QR payload (raw, or a JSON object with `order_number`) **before** short codes: `ticketing.ticketForLegacyCodeTx`, active barcodes only.
- A reissued ticket deactivates its legacy barcode too, as for yy1.
- Scans of legacy codes record `code_kind = 'legacy'`.
- The buyer's order page and the claim flow now read only the yy1 barcode. Otherwise a migrated ticket would show twice.

### Quarantine
- Money and ticket tables must quarantine **zero** rows, or the run fails: `bookings`, `transactions`, `commissions`, `tickets`, `attendees`, `checkins`, `promocodes`, `ticket_promocode`.
  - Causes: an unknown event or ticket, a negative or unparsable amount, a discount above the price, a hand-on without its parent, a commission or check-in without its booking.
- Content tables may quarantine up to **0.5 %** (invalid JSON; the row still migrates without that value).

### Validation (every run; `pnpm migrate:legacy:validate` re-runs it)
- The legacy side is recomputed from staging, never from the transforms' working tables.
- The output is a JSON report and a human summary. Any breach fails the run (exit 1).
- **V1** row counts with split factors:
  - users = distinct normalized emails
  - orgs = organizers (+ ABC)
  - events and ticket types 1:1
  - tickets = attendees = Σ order-item units = Σ `bookings.quantity`
  - orders = distinct checkouts
  - refunds
  - commission rows summed into statements
  - hand-ons mapped
- **V2** money per event × instance, equal to the cent: gross, fees, discounts, refunds, commission, earning, open.
- **V3** ticket status distribution by legacy booking state (orders by status reported).
- **V4** referential integrity: 0 orphans across tickets, items, attendees, users, members, refunds, scans, barcodes and every `legacy.ref` target, and every active ticket has its yy1 code.
- **V5** merged users = distinct emails across both instances, no pre-hijack violation, no staff from legacy users.
- **V11** RLS ENABLE + FORCE on every table with `org_id`, and a two-org probe as `app_user`: it sees its own orders, 0 of the other org's orders or tickets, and is denied the staging and control schemas.
- **V12** timezone spot checks: 50 events (the wall clock round-trips, DST gaps excepted) and 50 check-ins (UTC time and regional day), with DST folds and gaps logged.
- Not yet: V6–V10 (QR/token vector suites, golden queries, facade twin diff, URL inventory, checksums).

### Idempotence and time
- A rerun on the same dump produces identical ids and no duplicates (integration test).
- Measured on the `large` synthetic dataset: 4,936 events, 295,863 booking rows (about 300,000 tickets), 78,981 users, 301,857 attendee rows, 264,353 commissions and 125,868 check-ins, 1.19 M legacy rows in all. It ran on Postgres 18 in Docker (`shm_size` 256 MB) in the 4-vCPU, 15 GB cloud container. Both instances took **8 min 19 s** end to end (below), well inside the roadmap's ≤ 60 min for production size.

| Stage (seconds) | yay (942,062 rows) | abc (249,694 rows) |
|---|---|---|
| Load (stream + COPY + indexes) | 42.6 | 13.6 |
| T1 identity | 7.7 | 3.2 |
| T2 orgs | 4.7 | 1.6 |
| T3 catalog | 11.0 | 5.5 |
| T4 commerce | 155.5 | 43.6 |
| T5 check-ins | 17.6 | 4.9 |
| Codes and links (Ed25519 signing, legacy QR, manage tokens) | 119.0 | 29.9 |
| Analyze + validation | 20.7 | 17.7 |
| **Total** | **379.0 (6 min 19 s)** | **120.2 (2 min 0 s)** |

Temporary working tables are analyzed explicitly, because autovacuum never analyzes temp tables and the first timed run stalled on bad plans. `LEGACY_TRACE=1` logs every statement slower than 0.5 s. The slowest single statements are about 13 s: contacts, tickets and short codes at 240k rows.

### Browser e2e (`apps/web/e2e/legacy-migration.spec.ts`; the global setup runs `migrate:legacy:demo`)
- The migrated organizer signs in through the real form, keyboard only, with the legacy bcrypt password. They land in the migrated org and find its migrated events, and the session survives a reload.
- They see:
  - the event, in its venue timezone, with imported check-ins counted
  - the migrated orders, including an order's detail with its tickets
  - the migrated attendees with their ticket codes, and search
- They scan a migrated ticket at the door with its **legacy QR payload** ("Welcome in"). The same ticket by short code reports already checked in, and an unknown legacy-looking code is not a valid ticket. A rerun on a used database undoes and rescans.
- The migrated buyer's order link shows both tickets with their QR codes.
- A wrong order link is a 404.
- A migrated **scanner** sub-account signs in and is refused the orders, attendees and order detail of its organizer's events (not-found page).
- axe runs on every screen, and the event console and the order page are checked in Arabic (RTL).
- Console fix found by this: an event page opened by a member whose role cannot read events (e.g. `scanner`) was a 500. It now shows the not-found page.

### Schema (migration `0041_icy_raza.sql`)
- New tenant tables (ENABLE + FORCE RLS, the NULLIF policy, org-leading indexes, fixture rows for both orgs):
  - `payments.legacy_settlements`
  - `tenancy.org_relationships`
- New nullable column `orders.orders.charge_model`, with a CHECK.
- `checkin.scans.code_kind` now allows `legacy`.
- Hand edits (between `-- hand-written: begin/end`):
  - both CHECKs on existing tables are added `NOT VALID` and then validated
  - the cross-module composite FK `legacy_settlements (org_id, event_id) → events.events (org_id, id)`

### Gates touched (strengthened, not relaxed)
- **Schema guard** (`packages/db/src/guard.ts`, `isMigrationSchema`): the `legacy` and `legacy_{inst}` schemas are exempt from the tenant-table rules only while `app_user` and `platform_reader` have no USAGE on them. Otherwise the guard reports a violation (tested). The isolation suite skips them for the same reason.
- **check-modules**: new rule `migrator-access` with its canary.
- **docker-compose**: Postgres gets `shm_size: 256mb`. Parallel queries at rehearsal scale ran out of Docker's default 64 MB.

### Pending owner (defaults chosen as below; also in docs/owner-inbox.md)
- **Event clock.** The roadmap says event wall-clock fields are venue-local. The legacy code shows they were saved in the platform timezone (`serverTimezone()`), so the default is `--event-clock=platform`, with the event rendered in the venue's zone. Confirm with M0.4 data, or switch to `venue`.
- **System timezone.** System timestamps are read in `regional.timezone_default` from each dump (yay America/New_York, abc America/Chicago in the synthetic data), overridable with `--system-timezone`. The roadmap expects America/New_York; confirm per instance.
- **ABC owner.** The earliest abc admin becomes the ABC org's owner and the other admins become admins. Name the right owner if different.
- **The ABC org's slug** is `abc`.
- **Legacy sub-account roles.** Scanner → `scanner` + `door_staff` (least privilege: scanners could only scan). The console does not yet let an org-role scanner open an event (below).

### Later / not yet
- **T3 remainder:** venues directory, categories/tags, `event_series` inference, typed sub-entities (sessions, speakers, exhibitors, sections, announcements), occurrences of repetitive events, seat charts → `layout_v1`, media copy to R2.
- **T4 remainder:** failed bookings archive, the exact legacy fee-schedule import (`billing.fee_schedules`), `billing_customers` (Cashier `cus_` ids), bulk (comp) bookings as comps, distribution records (the unit's holder moves today), multi-day attendee rows per day.
- **T5 remainder:** guest lists (glists/guests), event codes, private info, kids counts.
- **T6–T9:** communications and consents (`unknown_legacy`), CMS content (`pages` is loaded to staging only), personal access tokens and magic links, contacts/participation/metric backfills, and `domain_events` backfill with `replayed=true`. Sending buyers their new order links belongs to T6.
- **Auth:** the 180-day acceptance of the second instance's bcrypt hash for merged identities. It is stored in `legacy.credentials`; the verifier checks only the primary. Conflicting Apple/Google ids → manual review. Merging beta tenants at cutover (the tool already never overwrites a new-platform password).
- **Validation:** V6–V10; a Playwright screenshot diff for seat charts.
- **Offline scanning** of legacy payloads (the manifest carries yy1 codes only).
- **Scanner role in the console.** `getEventBySlug` needs `events:read` without an `eventId`, so event roles cannot apply. Org-role scanners, migrated or new, cannot open an event's check-in page. A scoped fix (event-role-aware event lookup) is a small auth change for the owner to approve.
- **Nightly masked rehearsals in CI** once masked dumps exist (roadmap §7.5 step 6). Today CI runs the synthetic pipeline in the integration suite and before the e2e suite.

### Acceptance (M2.2b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The synthetic generator is deterministic, marked SYNTHETIC with example domains only, parses with the legacy-mask reader, and plants every edge case (grouping, hand-ons, gateways, duplicates, DST, shared emails, pre-hijack twin, invalid attendee emails) | `tools/legacy-migrate/tests/synth.test.ts` |
| AC2 | Deterministic UUIDv7 ids, email normalization, short codes, slugs, DST fold/gap conversion, check-in instant, venue timezone, staging type rules, grouping and the exact money split | `tools/legacy-migrate/tests/core.test.ts` |
| AC3 | The SQL twins equal the TypeScript rules | `tools/legacy-migrate/tests/migrate.int.test.ts` ("SQL twins") |
| AC4 | Load, T1–T5 and code issuing on both instances pass V1–V5, V11 and V12 with zero quarantine; staging and control schemas are not visible to app_user or platform_reader; cutover needs its explicit confirmation | `migrate.int.test.ts` ("runs and reports") |
| AC5 | T1: identity merge across instances, bcrypt carried, no staff, pre-hijack guard, new-platform password never overwritten | `migrate.int.test.ts` ("T1 identity") |
| AC6 | T2: orgs, owners, sub-account and event roles, Stripe accounts, managed domain; the ABC parent with host_affiliate children and abc.yayatoh.com | `migrate.int.test.ts` ("T2 orgs") |
| AC7 | T3/T4: time rules, orders from multi-row checkouts, distributable rows and hand-ons, attendee email from `address`, charge models and funds flow, refunds and statuses, legacy statements and opening balances, manage token + QR on the order page | `migrate.int.test.ts` ("T3/T4") |
| AC8 | T5 and the legacy QR: admissions + legacy scans; a migrated ticket scans by its legacy payload (raw or JSON); duplicated payloads are not attached | `migrate.int.test.ts` ("T5"); `packages/modules/checkin` scan path |
| AC9 | A rerun produces identical ids and no duplicates | `migrate.int.test.ts` ("idempotence") |
| AC10 | Quarantine: a money row fails the run; a content table passes at ≤ 0.5 % and fails above | `migrate.int.test.ts` ("quarantine rules") |
| AC11 | Every validation (V1, V2, V3, V4, V5, V11, V12) catches a planted defect, and the state passes again after | `migrate.int.test.ts` ("planted defect") |
| AC12 | The migrator connection is limited to tools/legacy-migrate | `tools/check-modules/tests/check.test.ts` (canary `migrator-access`) |
| AC13 | Browser: the migrated owner signs in with the legacy password and sees the migrated event, orders (and one order), attendees and check-ins; scans a migrated ticket by its legacy QR; the buyer's order page shows tickets with QR; a scanner sub-account is refused; axe; Arabic RTL; keyboard; rerun-safe | `apps/web/e2e/legacy-migration.spec.ts` |
| AC14 | Full run time on a realistic synthetic dataset measured and recorded | this section (timing table); `docs/runbooks/legacy-migration.md` |

## Next
- M2.2c: T3 remainder (venues, categories, series inference, sessions/speakers/sections, seat charts), T6–T9, V6–V10, and the dual-hash grace period, then the nightly masked rehearsal in CI once masked dumps exist.
