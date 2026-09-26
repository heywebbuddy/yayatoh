# Migration Strategy

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** shared-MySQL write phase and Cloudflare Worker router as default. See docs/roadmap.md §7.4.


## Topic

Migrating the live Laravel/MySQL Yayatoh platform (with live iOS/Android apps) to Next.js/TypeScript/PostgreSQL without downtime or breaking the apps

# Yayatoh 2.0 — Zero-Downtime Migration Strategy (Laravel/MySQL → Next.js/TypeScript/PostgreSQL)

Grounded in the vision doc's hard constraints: preserve every existing workflow (ticketing, QR, check-in, seating, distribution, imports, discovery), keep the store apps working "during and after the transition", and treat the mobile API as a first-class product. Date of research: 2026-09-26. Versions cited: Next.js 16.3.6 (security release 2026-09-22; 16.3.7 scheduled 2026-09-30), Laravel 12.x sources (13.x now current), PostgreSQL 18 (native `uuidv7()`), Debezium 3.6 stable, pgloader 3.6.9.

## 1. Recommended strategy in one paragraph

Run a **two-phase strangler**. **Phase A (app strangler, shared MySQL):** put an edge router in front of `yayatoh.com`, move web surfaces page-by-page to Next.js, and stand up the new TypeScript backend *against the existing MySQL database* (introspected schema, additive-only changes). No dual-write, no data migration yet, every page individually reversible. **Phase B (database cutover):** one rehearsed, short freeze (target < 60 min; CDC fallback if the rehearsed run exceeds ~90 min) migrates MySQL → PostgreSQL with an ELT pipeline, after which the new backend is the only writer. The mobile apps never see a URL change: the compat API keeps the exact Laravel JSON contracts, honours existing Sanctum tokens (no re-login), and a forced-update handshake shipped *early* lets you retire the legacy contract 3–6 months later.

Why not big-bang: every subsystem (auth, payments, QR validation, SEO, apps) would have to be perfect on one night. Why not dual-write: two sources of truth, conflict handling in both codebases, and no atomic rollback. Why not CDC from day one: it adds Kafka/DMS infrastructure to solve a window that a few-GB database likely does not need (decide after rehearsal #1 — see §5).

## 2. Strangler-fig routing

**Router choice (recommended): Cloudflare Worker in front of both origins.** Route by path prefix/regex, with cookie/header overrides (`yy_canary=next` forces the new stack; `yy_legacy=1` forces Laravel) and percentage rollouts per route. It is independent of both apps, gives you shadow mirroring (§8) for free, and is the same edge you will later use for white-label custom domains (Cloudflare for SaaS). Note: Cloudflare **Origin Rules** DNS-record/Host overrides are Enterprise-only (Free/Pro/Business get only port override), so a Worker, not Origin Rules, is the practical router.
*Runner-up:* Next.js as the front door with `rewrites.fallback` to Laravel (Next.js checks all its own routes, then proxies anything unmatched — the documented "incremental adoption" pattern). Simpler, but on Vercel external rewrites time out at 120 s and route handlers cap request/response bodies at 4.5 MB (a problem for CSV/Excel guest imports and media upload unless you use direct-to-S3 uploads). `proxy.ts` (renamed from `middleware.ts` in 16.0, Node runtime) can do DB-backed redirect lookups and per-request routing.
*Runner-up 2:* nginx/Traefik on the existing server if Laravel runs on a single Forge box — cheapest, no edge features.

**Coexistence rules:** preserve `Host` and `X-Forwarded-*` (Laravel `TrustProxies` must trust the router); do not collide cookie names (`laravel_session`, `XSRF-TOKEN` vs the new session cookie); both stacks read/write the same MySQL during Phase A; the new backend adds tables/columns only (new `organizations`, `organization_id` nullable columns, UUID columns) and never renames or drops. Laravel keeps owning writes for surfaces not yet moved.

**Move order (lowest risk → highest):**
1. Marketing/content: `/pages/about`, `/blogs` (SEO practice run, no auth).
2. Discovery (read-only, SEO-critical): `/`, `/events`, `/events/{slug}`, `/venues`. Reads MySQL via the new backend.
3. Auth: `/login`, `/register`, password reset — once §4 compat is done (bcrypt, remember-me, reset tokens).
4. Attendee purchase/checkout (Stripe) and ticket wallet — first surface with money; ship behind percentage rollout.
5. Mobile compat API `/api/*` served by the new backend (§3) — can happen in Phase A because it reads/writes the same MySQL.
6. Organizer dashboard, seating editor, distribution, check-in — after Phase B, because these are where the new multi-tenant model pays off and where the new schema diverges most.

## 3. Mobile API continuity

**Discover the contract.** (a) `routes/api.php` + `php artisan route:list --path=api -vv` (middleware/guards visible; `--json` output exists in modern Laravel — UNVERIFIED for Yayatoh's version). (b) `app/Http/Resources/*` (`JsonResource::toArray`) define exact keys; `app/Http/Requests/*` define validation and 422 error shapes. (c) Generate an OpenAPI 3.1 spec automatically with **Scramble** (dedoc/scramble; no annotations needed) — this becomes the parity contract. (d) The app source: grep the base URL and the HTTP client (Retrofit/Alamofire/dio/axios) for every path; note headers sent (`Accept`, `Authorization`, device id, locale). (e) Record a **golden HAR** of every screen of the *current store build* through mitmproxy/Charles. (f) Add access-log fields now (User-Agent, app version if present) to learn which endpoints and versions are actually live.

**Compat API in the new backend** (a `legacy-api` module, versioned as v1): identical paths, status codes, snake_case keys, Laravel pagination envelopes (`data/links/meta` or `current_page/...`), Laravel error bodies (`{"message":"Unauthenticated."}`, 422 `{"message","errors":{field:[...]}}`), integer ids stay integers, dates in whatever format the Resources emit (Laravel ≥7 default is ISO-8601 with microseconds and `Z`). Snapshot tests replay the golden HAR against both backends with noise normalisation.

**New API v2** side-by-side (`/api/v2`), OpenAPI-first, UUIDv7 ids, cursor pagination, org scoping, consumed by the rebuilt apps.

**Forced-update handshake:** apps send `X-App-Platform`, `X-App-Version`, `X-App-Build`; server holds `{min_supported, latest}` per platform; below minimum → `426 Upgrade Required` with `{"code":"UPGRADE_REQUIRED","store_url":...}` (the pattern Nextcloud uses); plus `GET /api/v2/app-config` on launch. Android: Play In-App Updates *immediate* flow (Android 5.0+, Play-distributed only; priority set via Play Developer API). iOS: no platform API — custom blocking dialog linking to the App Store. **The catch:** today's store builds do not understand 426, so step one is shipping a "bridge" build that implements the handshake and tolerates both backends. Only when that build is at ~90–95% of active sessions can you raise `min_supported`.

**Store timelines:** Apple states 90% of submissions reviewed in < 24 h (expedited review available for critical fixes); Google says up to 7 days, longer in exceptional cases. Adoption, not review, is the long pole — budget 90 days. Also mandatory now: iOS builds must use Xcode 26 / iOS 26 SDK (since 2026-04-28) and Play updates must target API 36 (since 2026-08-31).

**Sunset schedule:** T0 bridge build released → T+30 d compat API served by new backend (transparent) → T+90 d `min_supported` = bridge build → T+180 d legacy v1 endpoints return `410 Gone` with store link. Gate each step on version telemetry.

**Other app dependencies to check:** certificate pinning (moving TLS termination to Cloudflare/Vercel changes the chain and would brick pinned apps — top open question); push tokens (`device_tokens` table migrates as-is; FCM legacy API was shut down July 2024, so the new backend must send via FCM HTTP v1 with a service account; APNs `.p8` key and team/bundle ids carry over).

## 4. Auth compatibility

| Artifact | Laravel format (verified in 12.x source) | Node handling |
|---|---|---|
| Passwords | bcrypt `$2y$`, default 12 rounds (`BCRYPT_ROUNDS`), `rehash_on_login=true` so mixed rounds exist | **bcryptjs** (dcodeIO) accepts minor revisions `a`, `b`, `y` (checked in source). Native `bcrypt` (kelektiv) documents only `$2a$/$2b$` ("in theory compatible") — either use bcryptjs or rewrite the prefix `$2y$→$2b$` before compare (same algorithm). Respect the 72-byte limit. On successful login re-hash to argon2id (or bcrypt-12) and record the algorithm. |
| Sanctum tokens (mobile) | plaintext `{id}|{prefix}{40 random}{crc32b}`; DB stores `sha256(plain part)` in `personal_access_tokens.token`; `abilities` JSON, `expires_at`, `last_used_at`, `tokenable_type` = FQCN e.g. `App\Models\User` | `findToken` logic: split on first `|`, `SELECT ... WHERE id=?`, `timingSafeEqual(sha256(rest), row.token)`; fall back to lookup by hash when no `|`; enforce `expires_at` and global `sanctum.expiration`; update `last_used_at`. **Result: no mobile re-login.** Migrate the table verbatim. |
| Passport (if used instead) | RS256 JWT signed with `storage/oauth-private.key`; revocation in `oauth_access_tokens` | Verify with `jose` and `oauth-public.key`, check `jti` not revoked; honour until expiry, then re-login (skip re-implementing refresh grants). `tymon/jwt-auth`: HS256 with `JWT_SECRET` — trivial. |
| Web session | encrypted session id → PHP-serialized payload in DB/Redis/file | Do not port. Web users re-login once at Phase A step 3 (acceptable), **but** honour remember-me: |
| Remember-me cookie | name `remember_web_{sha1('Illuminate\Auth\SessionGuard')}`; value = Laravel-encrypted (`base64(JSON{iv,value,mac})`, AES-256-CBC with base64 `APP_KEY`, `mac = HMAC-SHA256(iv‖value)`), not serialized, prefixed by `HMAC-SHA1(name‖'v2', key)‖'|'` (CookieValuePrefix); plaintext `user_id|remember_token|<hash of password hash>` (SHA-256 of the bcrypt hash in current releases; older releases stored the raw hash — UNVERIFIED for Yayatoh's version); lifetime 576,000 min | ~60 lines in Node: decrypt, verify MAC, strip prefix, split, compare `users.remember_token` and hash, mint a new session. Keep `APP_KEY` as a *legacy secret* in the new backend for ≥12 months. |
| Password reset | `password_reset_tokens(email, token=bcrypt(plain), created_at)`; plain = `HMAC-SHA256(random40, hashKey)`; 60-min expiry | Honour in-flight links for the first hour after cutover via bcrypt compare; then table is dead. |
| Signed URLs (ticket links, email verification, unsubscribe) | `signature = HMAC-SHA256(full URL without signature param, APP_KEY)`, optional `expires` | Implement the verifier; old emails keep working for a year. |

## 5. Data migration MySQL → PostgreSQL

**Tool decision.**
- **pgloader 3.6.9** (Common Lisp; effectively maintenance-only, a v4 rewrite exists only as dev builds — UNVERIFIED status): one-shot, sensible default casts (`tinyint(1)`→boolean, `datetime`→`timestamptz`, enums→PG types, blobs→bytea), no views/triggers, zero dates need `zero-dates-to-null`, unsigned ints can overflow.
- **AWS DMS** (full load + CDC; ~$0.08/h `dms.t3.medium`, Serverless $0.0819/DCU-h US-East — third-party price summaries, UNVERIFIED on aws.amazon.com/dms/pricing): needs `binlog_format=ROW`, `binlog_row_image=FULL`, ≥24 h binlog retention; does **not** migrate AUTO_INCREMENT, secondary indexes or FKs (pre-create target schema), maps JSON→CLOB, converts TIMESTAMP to UTC but leaves DATETIME as-is, does not propagate `ON DELETE CASCADE` events.
- **Debezium 3.6** MySQL connector → Kafka/Debezium Server → JDBC sink (upsert mode, PostgreSQL dialect): most control, most infrastructure.
- **Custom TypeScript ETL** (`mysql2` streaming → transform → `pg` COPY): full control over reshaping, but you re-implement type mapping.

**Recommendation: ELT.** Use pgloader to lift MySQL byte-for-byte into a `legacy.*` schema in PostgreSQL (fast, rehearsable, explicit `CAST` rules for the columns where `tinyint(1)` is really a small enum), then run versioned, idempotent SQL/TypeScript transforms *inside PostgreSQL* to build the new schema. Set-based transforms are 10–100× faster than row-by-row ETL, testable in CI against a snapshot, and the `legacy` schema stays around as an audit trail. Runner-up: DMS full-load+CDC if rehearsal shows the freeze exceeds ~90 min.

**Schema mapping decisions (Laravel conventions → new model).**
- **Ids:** new PK `id uuid DEFAULT uuidv7()` (PG 18 native; time-ordered, safe for multi-tenant/offline check-in devices generating ids) **plus** `legacy_id bigint UNIQUE NULL` on every migrated table and a `legacy_ref(table, legacy_id, new_id)` map for polymorphic pointers. All public URLs/QR codes/emails keep resolving by legacy id or slug forever.
- **Timestamps:** `created_at/updated_at` are `DATETIME` without zone, written in `config('app.timezone')` — verify it is `UTC`; if it is `America/New_York`, convert explicitly (`AT TIME ZONE`) or dates shift by 4–5 h. Target `timestamptz`.
- **Soft deletes:** keep `deleted_at timestamptz NULL` + partial indexes `WHERE deleted_at IS NULL`; decide per table whether the new module keeps soft-delete semantics.
- **Polymorphic `*_type`:** default Laravel stores FQCNs (`App\Models\Event`) unless `Relation::enforceMorphMap` is used — map to short aliases via a lookup table; watch backslash escaping in COPY.
- **JSON:** MySQL `JSON` → `jsonb`; TEXT columns with `$casts=['x'=>'array']` may hold empty strings/invalid JSON — clean in the transform. **spatie/laravel-translatable** columns (`{"en":..,"fr":..}` for the 12 UI languages) stay `jsonb`.
- **Enums:** `text` + `CHECK` constraint rather than PG enum types (cheaper to evolve).
- **Unsigned bigint → bigint;** check `MAX(id)` < 2^63 (always true in practice).
- **Collation:** MySQL `utf8mb4_unicode_ci` is case-insensitive; PostgreSQL is not. Before migration, find duplicates that differ only by case (emails, slugs, promo codes); use `citext` or `UNIQUE (lower(email))`.
- **Zero dates** → NULL. **FULLTEXT** indexes are derived data — rebuild as `tsvector` generated columns + GIN, or re-index Meilisearch/Typesense at cutover (check Laravel Scout driver).
- **spatie packages:** `media` (model_type/model_id, disk, file_name, custom_properties/generated_conversions JSON, order_column) → `media_assets` with `organization_id`; keep the on-disk path convention (`{id}/{file_name}`, `{id}/conversions/...`) so no files move. `laravel-permission` (`roles`, `permissions`, `model_has_roles` polymorphic) — roles are global today; the transform assigns each existing role to the organization created for that user. `activity_log` → import as an immutable audit archive.
- **Multi-tenancy backfill:** create one `organization` per existing organizer/team account; stamp `organization_id` on every row via the join chain (event → owner); quarantine orphans in a report rather than failing the run.

**Seat maps and QR tickets.** First, inspect the actual QR payload (plain code, URL like `/tickets/verify/{code}`, signed URL, or JSON). Rules: never regenerate codes for issued tickets; store `tickets.legacy_qr_payload` verbatim with a unique index; the scanner resolves legacy payload by exact match first, then the new format; if the payload is a URL, the strangler keeps that route alive; if it is HMAC-signed with `APP_KEY`, keep the key. New tickets use an opaque code plus a compact HMAC-signed payload (e.g., `YT1.<uuid-base32>.<sig>`) so scanners can validate offline. Seat layouts: migrate the existing layout JSON as `layout_v1 jsonb` with a converter to the new floor-plan model; **seat ids must stay stable** because tickets/assignments reference them; add a validation that every seat referenced by a ticket exists in the converted layout.

**Media.** Already on S3: keep the bucket/prefix, no copy. Local `storage/app/public`: `rclone`/`aws s3 sync` to S3 or R2 the week before, delta sync during the freeze, and keep `/storage/...` URLs working via an edge rewrite for ≥12 months (they are embedded in old emails and blog posts).

**Validation suite (automated, run on every rehearsal):** per-table counts, checksums on money and status columns, referential integrity, and ~30 "golden queries" (revenue per event last 90 days, tickets sold/distributed/claimed per event, check-ins per event, seats assigned) computed on MySQL and PostgreSQL and diffed to zero.

## 6. Cutover strategy and rollback

**Freeze-and-migrate (recommended if rehearsal < 60 min).** Pick a window with no events within ±6 h (query `events`), e.g., Tuesday 03:00–05:00 ET. Mechanics: `php artisan down --secret=... --render="errors::503" --retry=600 --refresh=15` (use the cache-based maintenance driver on multi-server), edge serves a maintenance page for HTML and `503 + Retry-After` JSON for `/api/*` (test that the *current* store builds show a graceful message on 503 — do this in rehearsal). Drain Horizon/queues before freeze (maintenance mode stops job processing anyway), stop the scheduler, confirm zero writes (`SHOW PROCESSLIST`, binlog position), snapshot, run the pipeline, validate, smoke test, flip the router.

**CDC continuous replication (fallback).** DMS or Debezium pre-syncs; the final cutover is minutes (stop writers, wait for lag = 0, validate, flip). Costs infra and two weeks of setup; worth it only if the freeze cannot be kept short.

**Dual-write: rejected** (see §1).

**Rehearsals:** at least three full runs on restored production snapshots, scripted end-to-end (`make cutover`), timed, with the validation suite; the last one ≤7 days before on a fresh snapshot. Record actual durations; they set the announced window.

**Rollback plan.** Before the first PostgreSQL write: flip the router back, `artisan up` — minutes. After writes begin, define a **point of no return** (e.g., T+24 h). Inside that window, rollback = reverse-replicate PostgreSQL → MySQL for the hot tables (orders, payments, tickets, check-ins, users, seat assignments) using either Debezium's PostgreSQL connector (`wal_level=logical`, `pgoutput`, `REPLICA IDENTITY FULL`) with the JDBC sink in upsert mode, or a reverse ETL script written and tested during rehearsal. Keep Laravel + MySQL intact and read-only for 30 days; archive the final snapshot for 12 months.

**Stripe:** register the new webhook endpoint in advance (16 endpoints per account allowed), make handlers idempotent by `event.id`, return 503 (not 200) during the freeze — Stripe retries with backoff for 3 days. Same Stripe account, so customers/PaymentIntents/refund history need no migration beyond ids.

## 7. SEO preservation

Same domain → no Search Console "Change of address". Inventory URLs from sitemaps, GSC Performance export (top landing pages by clicks = protected list), server logs, and a crawl. Keep `/events/{slug}`, `/venues/{slug}`, `/blogs/...` identical wherever possible; where paths change, keep a DB-backed `legacy_redirects` table served from `proxy.ts` (config-file redirect lists have platform size limits — exact Vercel number UNVERIFIED). Google recommends permanent server-side redirects (301/308) kept ≥1 year; Next.js `permanent: true` emits 308. Sitemaps via `app/sitemap.ts` + `generateSitemaps` (50,000 URLs / 50 MB per file → index; `lastmod` must reflect real content changes); keep the old `/sitemap.xml` path. Canonical and `hreflang` for the 12 locales via the Metadata API (`alternates.canonical/languages`); when white-label domains arrive, canonicalize to the tenant's domain and `noindex` duplicates. Event JSON-LD: required `name`, `startDate` (ISO-8601 with offset), `location` (Place + PostalAddress); recommended `endDate`, `image`, `offers{url,price,priceCurrency,availability,validFrom}`, `eventStatus`, `eventAttendanceMode`, `organizer`, `performer`; virtual-only events are ineligible (doc updated 2026-09-08). Verify 20 sample pages in the Rich Results Test before and after. Guard rails: no accidental `noindex`/`X-Robots-Tag` from preview environments, robots.txt parity, 404 report from edge logs daily for two weeks, alert on >20% WoW click drop on protected pages.

## 8. Email and notification continuity

Keep the same From domain and provider account if at all possible (no reputation reset). If switching provider: publish new DKIM/Return-Path records in parallel (Postmark example: DKIM TXT, `pm_bounces` CNAME; verification ≤48 h), warm up with transactional mail first, then broadcasts; import suppression/bounce lists. Meet Gmail/Yahoo bulk-sender rules (≥5,000/day): SPF + DKIM + DMARC (p=none is acceptable), RFC 8058 one-click unsubscribe headers, spam rate < 0.3% (target < 0.1%). Inventory every scheduled job (`routes/console.php`/`Console/Kernel.php`) and every queued notification; each reminder gets an idempotency key (`event_id+recipient+type`) so the handover produces neither duplicates nor gaps. Old links keep working through the signed-URL verifier and redirect map. SMS/WhatsApp sender ids and WhatsApp templates belong to the provider account, not the code — unaffected if accounts are reused (providers in use UNVERIFIED).

## 9. Testing: parity and shadow traffic

- **Contract parity:** Scramble-generated OpenAPI → Schemathesis (property-based, stateful, follows links) run against Laravel to establish behaviour, then against the compat API; golden-HAR replay with diff normalisation (timestamps, ordering, ids).
- **Diffing:** Diffy (Sn126-maintained fork; Docker) with primary/secondary/candidate noise cancellation for read endpoints.
- **Shadow traffic:** at the edge, a Worker forwards each sampled request to both origins in `ctx.waitUntil`, serves the legacy response, and logs diffs (reference implementation: `OutdatedVersion/cloudflare-request-shadowing`); or Envoy `request_mirror_policies` with a percentage. Mirror **reads only**; mirror writes only into a sandbox (Stripe test mode, mail sink, throwaway DB).
- **E2E:** Playwright journeys (buy → distribute → claim → check-in → seat finder → refund) against both stacks; run the *current store builds* against staging via device DNS override.
- **Load:** k6 at 3× peak on on-sale bursts and check-in spikes; p95 < 300 ms on scan endpoints.
- **Data:** the §5 validation suite as a CI job against rehearsal databases.

## 10. Cutover-day runbook skeleton

**T-14 d:** Laravel code freeze (hotfixes only); rehearsal #3 passed; organizer comms (email + in-app banner); bridge app build adoption ≥ target; go/no-go criteria signed.
**T-7 d:** DNS/edge TTL 60 s; Stripe new endpoint registered; email DNS verified; redirect map and sitemaps loaded; on-call roster; status page prepared.
**T-1 d:** fresh snapshot → dry run on it; backups restore-tested; maintenance page pre-rendered; reminder comms.
**T-0 (window):** 1) status page "maintenance"; 2) edge → maintenance (503 + Retry-After for API); 3) `artisan down`, drain and stop queues/scheduler; 4) confirm no writes, snapshot, record binlog coordinates; 5) run ELT pipeline (timed) → validation suite → **go/no-go #1**; 6) media delta sync, search reindex, cache warm; 7) enable new Stripe endpoint, disable old; 8) smoke tests: bcrypt login, real-device Sanctum token, live $1 purchase + refund, scan a *legacy* QR ticket, seat finder, dashboard vs golden queries → **go/no-go #2**; 9) router → 100% new stack; Laravel DB user set read-only; 10) 2-hour watch: 4xx/5xx by path, app-version mix, email/webhook deliveries; 11) status page "resolved".
**T+1…7 d:** daily 404/GSC/support review; rollback path warm until point of no return.
**T+30 d:** decommission Laravel (archive snapshot); **T+12 mo:** retire `APP_KEY`-dependent compat (signed URLs, remember-me) and legacy redirects after log review.

## 11. Decision points

1. Router: Cloudflare Worker (recommended) vs Next.js fallback rewrites vs nginx.
2. Phase A on shared MySQL (recommended) vs building on PostgreSQL from day one with CDC.
3. Freeze-and-migrate vs CDC — decided by rehearsal #1 duration.
4. UUIDv7 primary keys with `legacy_id` (recommended) vs keeping bigint keys.
5. Which auth artefacts to honour: Sanctum tokens (must), remember-me (should), reset tokens (cheap), web sessions (no).
6. Legacy API sunset date, gated on bridge-build adoption telemetry.
7. Email provider: keep vs switch (switching adds warm-up risk during the most sensitive weeks).


## Key recommendations

- Use a two-phase strangler: first move web surfaces and the API onto the new stack while both stacks share the existing MySQL (additive schema changes only), then do one rehearsed short-freeze database cutover to PostgreSQL; reject dual-write.
- Put a Cloudflare Worker (or equivalent edge router) in front of yayatoh.com to route by path with cookie/header overrides and percentage rollouts; note Cloudflare Origin Rules host/DNS overrides are Enterprise-only, and Vercel external rewrites time out at 120 s with a 4.5 MB body cap on functions.
- Build a byte-for-byte compatibility API (same paths, Laravel JSON envelopes, error shapes, integer ids) generated from a Scramble OpenAPI spec and a golden HAR recorded from the current store builds; run v2 alongside.
- Ship a 'bridge' mobile release early that sends X-App-Version/Platform headers, handles 426 Upgrade Required and an app-config endpoint, and uses Play In-App Updates (immediate) on Android; raise min_supported only at ~90-95% adoption, budget 90 days, retire v1 with 410 at ~T+180 d.
- Honour existing Sanctum tokens in Node (split on '|', sha256 compare with hash_equals semantics, expiry checks) so mobile users never re-login; verify bcrypt $2y$ hashes with bcryptjs (accepts a/b/y) or rewrite the prefix to $2b$ for the native module; re-hash on login.
- Keep APP_KEY as a legacy secret for 12 months to decrypt remember-me cookies (CookieValuePrefix + AES-256-CBC + HMAC-SHA256) and verify Laravel signed URLs in already-sent emails; honour in-flight password reset tokens for one hour.
- Migrate with ELT: pgloader lifts MySQL into a legacy.* schema in PostgreSQL 18, then idempotent set-based SQL/TS transforms build the new multi-tenant schema (UUIDv7 PKs + legacy_id, timestamptz with explicit app-timezone handling, jsonb, morph-type aliases, citext/lower() uniqueness, tenant backfill); fall back to AWS DMS CDC only if the rehearsed freeze exceeds ~90 min.
- Never regenerate issued QR codes: store the legacy payload verbatim with a unique index and resolve it first at scan time; keep seat ids stable when converting layout JSON and validate every ticket-referenced seat exists.
- Rehearse the full cutover at least three times on production snapshots with an automated validation suite (counts, checksums, ~30 golden business queries); define a point of no return and a tested reverse-replication/reverse-ETL rollback for hot tables.
- Preserve SEO on the same domain: identical event/venue/blog URLs where possible, DB-backed 301/308 redirect map kept >= 1 year, sitemap index within 50k URLs/50 MB, canonical + hreflang for 12 locales, and complete Event JSON-LD verified with the Rich Results Test.
- Keep the same sending domain/provider through cutover; if switching, dual-publish DKIM/Return-Path, warm up transactional first, meet Gmail/Yahoo bulk-sender rules (SPF+DKIM+DMARC, RFC 8058 one-click unsubscribe, <0.3% spam), and give every scheduled reminder an idempotency key so the handover neither duplicates nor drops messages.
- Test parity with Schemathesis + golden-HAR replay + Diffy, shadow read traffic at the edge before flipping routes, run Playwright end-to-end purchase/check-in/seat-finder journeys against both stacks, and load-test scan endpoints at 3x peak.


## Data model implications

- Every migrated table gets `id uuid DEFAULT uuidv7()` as PK plus `legacy_id bigint UNIQUE NULL`; a `legacy_ref(table, legacy_id, new_id)` map resolves former polymorphic pointers.
- `organizations` entity with `organization_id` on all tenant-owned rows; migration creates one organization per existing organizer/team and stamps rows via the event->owner chain; orphans reported not dropped.
- `tickets.legacy_qr_payload` (unique, indexed) preserved verbatim alongside the new signed ticket code; scanners resolve legacy first.
- Seat layouts stored as versioned `jsonb` (`layout_v1` legacy, `layout_v2` new floor-plan model) with stable seat ids referenced by seat assignments and tickets.
- `personal_access_tokens` migrated as-is (id, tokenable_type/id, token sha256, abilities jsonb, expires_at, last_used_at) to honour Sanctum tokens; `users.remember_token` and `password_reset_tokens` retained for the compat window.
- `users.password` keeps bcrypt `$2y$` hashes with a `password_algorithm` column to track re-hash to argon2id on login.
- Timestamps become `timestamptz`; `deleted_at` soft-delete columns retained with partial indexes; enums become text + CHECK; MySQL JSON/text-cast columns become validated `jsonb` (including spatie translatable multi-locale columns).
- Case-insensitive uniqueness (email, slug, promo code) enforced via `citext` or `lower()` unique indexes to replace MySQL `_ci` collation semantics.
- `media_assets` (from spatie `media`) keyed by organization with the original disk path convention preserved; `legacy_redirects(source_path, target_path, status)` table for SEO; `app_versions(platform, min_supported, latest, store_url)` for the forced-update handshake.
- RBAC re-scoped from global spatie roles/permissions to per-organization memberships; `activity_log` imported as an immutable audit archive; `device_tokens` migrated for FCM v1/APNs push.
- Idempotency keys on notifications/reminders (`event_id + recipient + type`) and on Stripe webhook processing (`event.id`) to survive the handover.


## Risks

- Current store builds may use certificate pinning; moving TLS termination to Cloudflare/Vercel would break them until a new build ships (UNVERIFIED).
- The exact QR payload format and seat-map JSON structure are unknown; if payloads embed signed URLs or APP_KEY HMACs, losing the key or route breaks every issued ticket.
- Laravel app timezone may not be UTC; DATETIME columns migrated without explicit conversion would shift all event times by hours.
- MySQL case-insensitive collation hides duplicates (emails/slugs) that become unique-constraint violations in PostgreSQL.
- pgloader is effectively in maintenance mode (3.6.9); edge cases (unsigned ints, zero dates, tinyint(1) misdetection) must be handled with explicit CAST rules and caught by the validation suite.
- AWS DMS does not migrate AUTO_INCREMENT, secondary indexes, FKs, or cascade events and maps JSON to CLOB; using it without a pre-created target schema silently loses structure.
- Existing store builds may not handle 503/426 gracefully; a maintenance window could look like an outage or crash loop on devices until the bridge build is adopted.
- Slow mobile update adoption (weeks to months) forces the legacy API contract to live longer than planned; retiring it early strands users.
- Scheduled reminders/campaigns double-send or go missing at handover if jobs are not inventoried and made idempotent.
- Email reputation reset or DMARC/DKIM misalignment if the sending provider or domain changes during cutover weeks.
- SEO traffic loss from changed URLs, missing redirects, accidental noindex from preview environments, or degraded Event structured data.
- After the point of no return, rollback requires reverse replication; without a tested reverse ETL, a late-discovered data defect has no clean recovery path.
- Vercel-hosted route handlers cap bodies at 4.5 MB, which breaks large CSV/Excel guest imports and media uploads unless direct-to-storage uploads are used.
- APP_KEY and oauth keys must be provisioned into the new backend as legacy secrets; leakage or premature rotation invalidates cookies, signed links, and Passport tokens.


## Open questions

- Which auth package do the mobile apps use today: Sanctum, Passport, tymon/jwt-auth, or custom tokens? Do users also sign in with Google/Apple (Socialite) or 2FA?
- Do the iOS/Android apps pin TLS certificates or hard-code the API host? Can the base URL be overridden for staging tests? What technology are they built in (native, Flutter, React Native)?
- What exactly is encoded in ticket QR codes (plain code, URL, signed URL, JSON)? Is any part HMAC-signed with APP_KEY?
- What is `config('app.timezone')` in production, and is MySQL running with the same server timezone?
- Where is media stored today (S3, local disk, DigitalOcean Spaces), and roughly how many GB? How large is the MySQL database and what are the biggest tables?
- Which email/SMS/WhatsApp/push providers and accounts are in use (SES, Mailgun, Postmark, Twilio, Meta WABA, FCM legacy vs v1), and what daily volumes?
- Is Laravel Scout in use and with which driver (database, Meilisearch, Algolia)?
- Which spatie packages are installed (medialibrary, permission, activitylog, translatable, sluggable), and is a morph map enforced?
- How are the 12 UI languages exposed in URLs (path prefix, query, cookie) and do localized event pages exist for SEO?
- What are the current event volumes and peak times (on-sale bursts, check-in spikes) to choose a freeze window and load-test targets?
- Are there third-party API consumers or integrations (Zapier, embed widgets, partner sites) beyond the two apps that depend on current endpoints?
- Hosting today (Forge/VPS, RDS, Vapor?) and target hosting for the new stack (Vercel vs self-hosted Node on AWS/Fly) — this determines router choice and body-size limits.
- What is the acceptable maintenance window, and are there organizer contracts/SLAs that constrain it?
- Do organizers use Stripe Connect (per-organizer payouts) or a single Yayatoh Stripe account?


## Sources

- https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites (v16.3.6, updated 2026-06-30)
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy (v16.3.6, updated 2026-09-07)
- https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects
- https://nextjs.org/blog/incremental-adoption
- https://nextjs.org/blog/upcoming-nextjs-security-release-september-22-2026
- https://vercel.com/docs/limits
- https://vercel.com/docs/functions/limitations (updated 2026-08-24)
- https://developers.cloudflare.com/rules/origin-rules/
- https://github.com/OutdatedVersion/cloudflare-request-shadowing
- https://blog.markvincze.com/shadow-mirroring-with-envoy/
- https://laravel.com/docs/12.x/sanctum
- https://raw.githubusercontent.com/laravel/sanctum/4.x/src/HasApiTokens.php
- https://raw.githubusercontent.com/laravel/sanctum/4.x/src/PersonalAccessToken.php
- https://raw.githubusercontent.com/laravel/sanctum/4.x/src/Guard.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Encryption/Encrypter.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Auth/SessionGuard.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Cookie/Middleware/EncryptCookies.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Cookie/CookieValuePrefix.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Auth/Passwords/DatabaseTokenRepository.php
- https://raw.githubusercontent.com/laravel/framework/12.x/src/Illuminate/Routing/UrlGenerator.php
- https://raw.githubusercontent.com/laravel/framework/12.x/config/hashing.php
- https://laravel.com/docs/12.x/configuration (maintenance mode)
- https://laravel.com/docs/12.x/eloquent-relationships (custom polymorphic types)
- https://laravel.com/docs/12.x/routing (route:list)
- https://raw.githubusercontent.com/dcodeIO/bcrypt.js/main/index.js
- https://raw.githubusercontent.com/kelektiv/node.bcrypt.js/master/README.md
- https://github.com/dedoc/scramble
- https://raw.githubusercontent.com/spatie/laravel-medialibrary/main/database/migrations/create_media_table.php.stub
- https://pgloader.readthedocs.io/en/latest/ref/mysql.html
- https://github.com/dimitri/pgloader/releases
- https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Source.MySQL.html
- https://aws.amazon.com/dms/pricing/ (prices via third-party summaries; UNVERIFIED)
- https://debezium.io/documentation/reference/stable/connectors/mysql.html (Debezium 3.6)
- https://debezium.io/documentation/reference/stable/connectors/postgresql.html
- https://debezium.io/documentation/reference/stable/connectors/jdbc.html
- https://www.postgresql.org/docs/release/18.0/ (uuidv7)
- https://developer.apple.com/distribute/app-review/
- https://developer.apple.com/news/upcoming-requirements/ (Xcode 26 / iOS 26 SDK from 2026-04-28)
- https://support.google.com/googleplay/android-developer/answer/9859751
- https://support.google.com/googleplay/android-developer/answer/11926878 (target API 36 by 2026-08-31)
- https://developer.android.com/guide/playcore/in-app-updates
- https://github.com/nextcloud/spreed/issues/9660 (426 Upgrade Required client-version pattern)
- https://firebase.google.com/docs/cloud-messaging/migrate-v1
- https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/appearance/structured-data/event (updated 2026-09-08)
- https://support.google.com/a/answer/81126 (Gmail sender guidelines)
- https://postmarkapp.com/support/article/1046-how-do-i-verify-a-domain
- https://docs.stripe.com/webhooks
- https://github.com/opendiffy/diffy
- https://schemathesis.readthedocs.io/en/stable/
