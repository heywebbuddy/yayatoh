# M1.13 — `/v1` core API, docs and TypeScript SDK

Roadmap: M1.13 ("`/v1` per §6.1; mobile auth; `/v1/mobile/config`; scanner endpoints … Scalar docs; the TypeScript SDK") and the `/v1` half of M1.15 ("mobile-ready endpoints … generated TS/Swift/Kotlin SDKs … app-version telemetry per route"). ADRs 0002 (one command model), 0003 (RLS), 0010 (auth), 0014 (allowlists).

- **Risk tags:** `auth`, `tenancy`, `db-migration`, `mobile-contract` (additive `/v1` only).
- **Not in this milestone:** the legacy `/api/v2` facade (frozen; needs the golden HARs from the owner's apps, see "Facade needs" below).

## M1.13a — core resources (done)

**One router, two mounts.** `packages/api-v1` (`createV1(deps)`) is mounted by `apps/api` at `/v1` (api.yayatoh.com) and by the web app at `/api/v1` (same-origin for the Scan PWA and local API clients). The scanner routes from M1.9 are part of it.

**Authentication** (no cookies on `/v1`; `Authorization: Bearer …` only):
- **Org API keys** `yy_live_<43 base64url>`: `tenancy.api_keys` (tenant table, FORCE RLS). Only a SHA-256 of the key is stored; the key is shown once. The key resolves to (org, key, scopes) through the SECURITY DEFINER `tenancy.api_key_by_hash`, which returns nothing for revoked keys and for suspended or terminated orgs. Last use is stamped at most once a minute.
  - **Scopes** (`API_KEY_SCOPES`): `org:read`, `events:read`, `events:write`, `orders:read`, `orders:refund`, `attendees:read`, `checkin:scan`. The authorizer lets an `api_key` actor do exactly what its **live** scopes list (a revoke applies to the next request). A key never gets more than its creator's role (`scope_exceeds_role`), and never member-management or payout powers.
  - Managed by the new permission `api_keys:manage` (owner, admin). Commands `tenancy.createApiKey`, `tenancy.revokeApiKey`, query `tenancy.listApiKeys`, all audited.
  - Not the Better Auth api-key plugin: it stores user-bound keys in the identity schema without RLS. Org-bound keys as tenant rows follow the device-token pattern (M1.9). Pending owner (inbox).
- **User sessions for mobile/CLI**: `POST /v1/auth/login` (email + password) returns a Better Auth session token used as a bearer token (the `bearer` plugin; no cookie is set). `POST /v1/auth/refresh` slides the expiry; `POST /v1/auth/logout` ends it at once. Accounts with two-factor sign-in get `step_up_required` (`two_factor_required`): use the web sign-in. Login is limited per account (5 / 15 min) and per IP (100 / min).
- **Device tokens** (`yyd_…`, M1.9) keep working on the scanner routes, plus the new `POST /v1/checkins` (one online scan).

**Tenant selection.** Org resources live under `/v1/orgs/{org}` (`{org}` = id or slug). The org must equal the API key's org, or the session user must be a member; otherwise 404 (existence is not revealed). The tenant is never read from a header. The roadmap's `Yayatoh-Org` header (§6.1) is replaced by this path segment because the non-negotiable rules forbid header tenancy. Pending owner (inbox).

**Endpoints** (all outputs are Zod allowlists in `packages/api-v1/src/resources.ts`; every write goes through `executeCommand`):

| Method + path | What | Permission / scope |
|---|---|---|
| `GET /v1/health` | liveness | — |
| `POST /v1/auth/login`, `/refresh`, `/logout` | bearer sessions | — / session |
| `GET /v1/me`, `/v1/me/organizations` | the user, their orgs and roles | session |
| `GET /v1/mobile/config` | min/latest app versions, base URLs, flags | public |
| `GET /v1/public/events/{slug}`, `…/ticket-types` | published event + passes (all-in prices, availability) | public |
| `GET /v1/orgs/{org}` | organization | `org:read` |
| `GET, POST /v1/orgs/{org}/events` | list (cursor) / create draft | `events:read` / `events:write` |
| `GET, PATCH /v1/orgs/{org}/events/{eventId}` | get / update | `events:read` / `events:write` |
| `POST /v1/orgs/{org}/events/{eventId}/publish` | publish | `events:write` |
| `GET, POST /v1/orgs/{org}/events/{eventId}/ticket-types` | list / add | `events:read` / `events:write` |
| `PATCH /v1/orgs/{org}/ticket-types/{ticketTypeId}` | update | `events:write` |
| `GET /v1/orgs/{org}/events/{eventId}/orders` | orders, newest first (cursor) | `orders:read` |
| `GET /v1/orgs/{org}/orders/{orderId}` | order + tickets | `orders:read` |
| `POST /v1/orgs/{org}/orders/{orderId}/refunds` | refund tickets or an amount (policy, provider, reversal) | `orders:refund` |
| `GET /v1/orgs/{org}/events/{eventId}/attendees` | list (cursor, search, status) | `attendees:read` |
| `GET /v1/orgs/{org}/events/{eventId}/attendees/{attendeeId}` | one attendee | `attendees:read` |
| `GET /v1/orgs/{org}/attendees/search?q=` | org-wide search (60/min) | `attendees:read` |
| `POST /v1/orgs/{org}/events/{eventId}/checkins` | online scan verdict (check-in engine) | `checkin:scan` |
| `POST /v1/checkins` | the same for a device token | device |

**Conventions:**
- **Pagination:** `limit` (1–100, default 25) and an opaque `cursor` (base64url keyset: sort time at millisecond precision + id). Module list queries gained an optional `after` keyset input (`KeysetAfter` in contracts); the console's calls are unchanged.
- **Errors:** RFC 9457 `application/problem+json` with the kernel's stable codes (validation issues carry `details.issues[].path`). Internals never leak.
- **Idempotency:** every write requires `Idempotency-Key` (8–255 printable characters). The router runs the command with `idempotent: true`, so the kernel stores the output in the same transaction and a retry replays it (24 h); a different body with the same key is 422 `idempotency_key_reused`; a concurrent duplicate is 409. Scans map the key to the engine's `clientScanId` (first verdict returned). **Kernel fix:** replay revived only JSON, so outputs with dates failed to re-parse; `replayOutput` now revives exactly the fields the schema reports as dates.
- **Rate limits:** token buckets per credential (API key or user: 600/min; device: 3,000/min; anonymous per IP: 300/min, generous for shared venue IPs; search 60/min; login per account and per IP). `RateLimit-Limit/Remaining/Reset` on every response, `Retry-After` on 429. In-memory adapter behind the `RateLimiter` port; Upstash in production (owner account pending).
- **Request ids:** `X-Request-Id` echoed when well-formed, otherwise minted; it becomes the ctx `requestId`, so it lands in audit rows.
- **Refunds:** the console's refund orchestration moved to `refundOrder()` in the orders module and is shared by both transports.

**Console UI** — `/o/{org}/api-keys` (nav "API keys"):
- Create: name + scope checkboxes; server validation messages on the fields; the key is shown once with a Copy button and a "Copied" status.
- List: name, prefix, scopes, created, last used, status; Revoke per key (then the key gets 401).
- Link to the API reference. Viewers and other roles get an explanatory empty state and no form (commands refuse them too).
- 13 locales (`apiKeys.*`, `nav.apiKeys`), Arabic RTL.

## M1.13b — docs and SDKs (done)
- **Scalar reference** at `/v1/docs` (web: `/api/v1/docs`) reading `/v1/openapi.json`. The Scalar bundle and its start-up script are served from our own origin; the page's CSP (`default-src 'self'`) blocks Scalar's hosted fonts, so nothing third-party loads. Scalar's "Ask AI" and editor buttons still render in this version (the `agent`/`mcp` switches are passed but not honoured); under the CSP they cannot reach anything. The served document matches the committed one (`paths` under `/v1`) with a `servers` entry for the mount.
- **`packages/sdk` (`@yayatoh/sdk`)**: types generated by openapi-typescript into `src/schema.ts` from `apps/api/openapi.json`, plus a small client over openapi-fetch: `createYayatohClient({ baseUrl, token, client })`, `unwrap()` (throws `YayatohApiError` with `status`, `code`, `requestId`, `retryAfter`), `paginate()`, `idempotencyKey()`. Publish-ready, not published. `pnpm contracts:check` now also fails when the SDK types are stale.
- **Swift / Kotlin:** openapi-generator configs (`packages/sdk/mobile/swift.yaml`, `kotlin.yaml`) and `packages/sdk/scripts/generate-mobile.sh` (pinned Docker image, local only, no CI job; output git-ignored).
- The roadmap names `@hey-api/openapi-ts`; openapi-typescript + openapi-fetch is the smaller, zero-codegen-runtime choice. Pending owner (inbox).

## M1.13c — app-version telemetry (done)
- Every `/v1` request increments `platform.api_usage` (UTC day × route pattern × method × client × app version). No tenant, user or IP is stored. The client comes from `X-Yayatoh-Client: <client>/<version>`, else `X-App-Version` with the client guessed from the user agent, else `Yayatoh/<v>` in the user agent. Only known clients (`ios`, `android`, `web`, `scan-pwa`, `sdk-ts`, `sdk-swift`, `sdk-kotlin`) and semver-like versions are counted as given; anything else becomes `other` / `unknown`, so callers cannot mint counter rows. Writes go through the SECURITY DEFINER `platform.record_api_usage` (fire-and-forget; never fails a request).
- Staff read it in the admin console at **API usage** (`/api-usage`, platform_reader, audited): last 7 days by route, client and version.
- **Webhooks:** outbound subscriptions are M6.3. No seam was added here: the outbox and versioned domain events are already the natural seam.

## M1.13d — mobile-ready content reads, test keys, deprecation headers, Spectral (done)
Roadmap M1.15 ("`/v1` exposes the mobile-ready endpoints (… agenda) with generated TS/Swift/Kotlin SDKs") and M1.13 ("oasdiff is clean"). The apps are not built (§8.3): this is the contract a future app starts from.

**Content reads** (`packages/api-v1/src/routes/content.ts`; every output an allowlist in `resources.ts`):

| Method + path | What | Credential |
|---|---|---|
| `GET /v1/public/events/{slug}/sections` | visible content sections in page order (`kind` + typed `content`: text, faq, schedule, location, links) | public |
| `GET /v1/public/events/{slug}/announcements` | published `public`-audience announcements, pinned first then newest (cursor) | public |
| `GET /v1/public/events/{slug}/dates` | dates of a multi-date event in start order, cancelled ones marked, `soldOut` (cursor) | public |
| `GET /v1/public/events/{slug}/agenda?dateId=` | sessions grouped by day **in the event's timezone**, with track, room and speakers | public |
| `GET /v1/public/events/{slug}/speakers`, `…/speakers/{speakerId}` | speakers by name (cursor); one speaker + their sessions | public |
| `GET /v1/public/events/{slug}/exhibitors` | exhibitors by name (cursor) | public |
| `GET /v1/public/events/{slug}/sponsors` | sponsor tiers in order with their sponsors (empty tiers left out) | public |
| `GET /v1/public/events/{slug}/images` | cover, gallery and the organizer's logo with AVIF/WebP/fallback variants at **absolute, content-hashed, immutable** URLs | public |
| `GET /v1/public/venues`, `/v1/public/venues/{slug}` | the venue directory (cursor); a listed venue with photos and upcoming public events | public |
| `GET /v1/orgs/{org}/events/{eventId}/sections` | every section, hidden ones included (`visible`, `position`) | `events:read` |
| `GET /v1/orgs/{org}/events/{eventId}/announcements` | every announcement, drafts and holders-only included, newest first (cursor) | `events:read` |
| `GET /v1/orgs/{org}/events/{eventId}/dates` | dates with capacities (cursor) | `events:read` |
| `GET /v1/orgs/{org}/events/{eventId}/agenda?dateId=` | tracks, rooms (capacity) and sessions by day with ids, capacity, speaker ids | `events:read` |
| `GET /v1/orgs/{org}/events/{eventId}/speakers`, `…/{speakerId}`, `…/exhibitors`, `…/sponsors` | the organizer's view (empty sponsor tiers included) | `events:read` |
| `GET /v1/orgs/{org}/venues`, `…/venues/{venueId}` | saved venues, archived ones included (cursor) | `events:read` |

- **Visibility:** public routes resolve the event with `events.page_target` (published/postponed/cancelled/completed, public or unlisted, active org), the same SECURITY DEFINER target and serializers as the web's event page (`publicEventContent`, `publicOccurrences`, `publicProgram`, `publicMedia`, `publicVenue`). Private events, drafts and unknown slugs are the same 404. Access codes are a browser cookie flow and do not open anything on `/v1`. Private info and the join link are never read. Org routes check the event under the org's RLS first (another org's event is a 404).
- **Pagination:** the same `{ data, nextCursor }` contract with `limit` (1–100) and an opaque `cursor`. Per-event content is capped (≤ 500 sessions, 300 speakers/exhibitors, 366 dates), so each list is read whole and paged by a keyset over its sort key + id (`pageByKey`): a row added or removed between pages never shifts the next one. Grouped resources (agenda, sponsor tiers, sections ≤ 30) return whole, like ticket types. Name-sorted cursors may be up to 512 characters (`KeyPageQuery`).
- **Caching:** every new read sends a strong `ETag` (SHA-256 of the body) and answers `If-None-Match` with a bodiless **304**. Public: `Cache-Control: public, max-age=60` (the existing public routes' policy). Org: `private, no-cache`.
- **Images:** the media module's app-relative paths become absolute on `V1Deps.publicOrigin` (`apps/api`: `NEXT_PUBLIC_APP_ORIGIN`, the web origin that serves `/media/…`; the web mount uses its own origin). File names carry the SHA-256, so URLs never change for the same bytes. Bytes, uploader and source type are not exposed.
- **Public event (additive):** `category`, `attendanceMode` and `venueSlug` (links `GET /v1/public/venues/{slug}`).

**Test keys (`yy_test_…`).** `tenancy.api_keys.sandbox`; `createApiKey` takes `mode: 'live' | 'test'`. **Meaning (pending owner): read-only and no personal data** — a test key may hold only `TEST_KEY_SCOPES` (`org:read`, `events:read`), and reads the org's real non-personal data. Justification: test keys end up in laptops, CI logs and demo apps, so they must not mutate anything or reveal buyers and attendees; the roadmap's alternative (a linked sandbox org with fake-provider orders) needs a sandbox-org design and can be added later as a relaxation, which is not a breaking change.
- Enforced three times: the command refuses other scopes (`validation_failed`, `reason: test_key_scope`, issue on `scopes`); the table CHECK `api_keys_sandbox_check` ties `sandbox` to the `yy_test_` prefix and the scope subset; and the authorizer's live scopes (`apiKeyScopes`) and the identity intersect a sandbox key's scopes with `TEST_KEY_SCOPES`. The prefix is part of the hashed secret, so relabelling `yy_test_` ↔ `yy_live_` gives an unknown key (401).
- Rate limit `RATE_LIMITS.testKey`: 120/min (live keys 600/min).
- **Console:** the API keys form gains a **Key type** radio group (Live key / Test key, each with a hint); a refused scope shows "A test key can only read the organization and events…" on the scopes; a created test key says so; the list shows a **Test** badge next to the name (`data-testid="test-key-badge"`). 13 locales (`apiKeys.mode`, `modeLive`, `modeLiveHint`, `modeTest`, `modeTestHint`, `testBadge`, `testScopesInvalid`, `createdTest`), Arabic RTL.

**Deprecation / Sunset headers.** `deprecated(route, { since, sunset?, link? })` (`packages/api-v1/src/deprecation.ts`) marks a `createRoute` definition: the document shows `deprecated: true`, and `deprecationMiddleware` (mounted first in `createV1`, table read from the OpenAPI registry) adds `Deprecation: @<unix>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594) and `Link: <…>; rel="deprecation"` (+ `rel="sunset"`) to **every** response of the marked method + path, errors (401/429) included, on either mount. No route is deprecated yet (an integration test asserts it). Policy: deprecate with a replacement; removal after the sunset still needs the owner (the oasdiff gate stays).

**Spectral lint** (`apps/api/spectral/.spectral.yaml`, run by `pnpm contracts:check` via `pnpm --filter @yayatoh/api openapi:lint`, fail on warn). Spectral's OAS rules are off except: `operation-operationId(-unique, -valid-in-url)`, `operation-tags`, `operation-tag-defined`, `openapi-tags(-uniqueness)`, `tag-description`, `operation-description`, `info-description`; plus ours: `yayatoh-operation-summary`, `yayatoh-parameter-description`, `yayatoh-operation-success` (a 2xx), `yayatoh-named-enums` (custom function: every enum with more than one value is a `components.schemas` entry) and `yayatoh-pagination-params` (custom: a 200 with `nextCursor` needs `cursor` and an integer `limit` 1–≤100; `cursor` without `nextCursor` is flagged, except the scanner manifest's own sync `cursor`).
- **Existing spec fixed without breaking changes:** 29 operations gained `operationId`s (e.g. `listEvents`, `getScannerManifest`) and descriptions; every parameter a description; top-level `tags` with descriptions; inline enums became named schemas (`EventStatus`, `OrderStatus`, `ScanResult`, `ManifestTicketStatus`, …; the checkin module's DTOs now use `@hono/zod-openapi`'s `z`). One trap: a description on a `$ref` parameter schema wraps it in `allOf`, which oasdiff reads as removed enum values; the description sits on the parameter instead. **oasdiff `breaking` against `m0.5-foundation-ey5gqp`: no breaking changes** (53 info: endpoints and operation ids added).

**SDKs.** `@yayatoh/sdk` 0.3.0 regenerated (`pnpm --filter @yayatoh/sdk generate`). Swift 6 / Kotlin: the existing openapi-generator configs (`packages/sdk/mobile/{swift,kotlin}.yaml`) and `pnpm --filter @yayatoh/sdk generate:mobile` (`scripts/generate-mobile.sh`, pinned `openapi-generator-cli:v7.17.0` Docker image, output `mobile/out/`, git-ignored, not committed, no CI job). Verified locally against the new document: both generators succeed (e.g. Kotlin `PublicContentApi.getPublicEventAgenda`, Swift `DateStatus`, `ImageSlot`, `FaqSection`); the generated sources were not compiled (no Swift/Kotlin toolchain here). **Owner decision:** the Swift and Kotlin SDKs stay generated but uncompiled (and uncommitted) until the mobile apps are built (roadmap §8.3); only the generator configs and the script live in the repo.

## Later / not yet
- **The `/api/v2` facade (§6.2)** and M1.13's HAR acceptance: needs the golden HARs from both store builds (owner inbox, M0.3) and the M0.8 route list. It will need: a Hono sub-app at `apps/web/app/api/v2/[...route]`, host-namespaced instances, `compat_ids`, Sanctum token lookup (`packages/auth/compat/sanctum.ts` is ready) against migrated `personal_access_tokens` (M2 ELT), per-route × app-version × instance telemetry (the `platform.api_usage` pattern plus an instance column) and a kill switch per route.
- **"Migrated tokens work without re-login"**: needs the migrated Sanctum tokens (M2 ELT) and `/v1/auth/legacy-exchange`; not buildable before the ELT.
- **"Store builds complete login → buy → ticket → scan on staging"**: needs staging and the facade.
- **15-minute JWTs with rotating 60-day refresh families (PKCE, reuse detection)**: sessions are Better Auth's 14-day sliding sessions for now; do this before a mobile build ships.
- **Step-up for creating API keys** (ADR 0010): there is no step-up flow in the web yet (`stepUp` is unused everywhere); add it with the step-up UI.
- **Test keys beyond read-only** (M1.13d built read-only, non-personal test keys): a linked sandbox org whose orders run on the fake provider (Stripe test mode); per-key event lists; key expiry.
- `X-Yayatoh-Client` 426 handshake against `minimumVersions` (config is served; enforcement arrives with a mobile build); bracket filters, `expand[]`, sparse fields.
- Mobile endpoints for wallet passes, checkout sessions, seat map, RSVP and personal schedules: their features are not built yet (M4.7, M5.x); scanner manifest/lookup/device commands beyond M1.9's. (The agenda and other content reads are M1.13d.)
- **Scalar docs page accessibility (open):** axe finds violations inside Scalar 1.72.1's own markup on `/v1/docs`: `button-name` (critical: unnamed collapse buttons), `color-contrast` (sidebar search placeholder), `target-size` (group toggles, the MCP link) and `scrollable-region-focusable` (endpoint lists). None come from our document. Needs a Scalar upgrade/patch or our own reference page; until then the docs e2e checks content only.
- **M1.13d later:** `/v1` writes for content and the program (the console only for now); access-code unlocks on `/v1` (private events stay 404 publicly); speaker photos and exhibitor/sponsor logos (not in the media pipeline yet); ETags on the pre-M1.13d routes (their `Cache-Control` is unchanged); a CDN purge by tag when public content changes (max-age is 60 s); an ICS feed of the agenda.
- Upstash rate-limit adapter (owner account).

## Migration
`packages/db/drizzle/0039_graceful_dexter_bennett.sql` (expand only):
- new tenant table `tenancy.api_keys` (FORCE RLS, canonical policy, org FK, global unique `key_hash`, name/scope CHECKs);
- new global table `platform.api_usage` (listed in `GLOBAL_TABLES`);
- hand-written (between `-- hand-written: begin/end`): `tenancy.api_key_by_hash(text)` SECURITY DEFINER + grant to `app_user`; `REVOKE ALL` on `platform.api_usage` from `app_user` and `platform_reader`, `GRANT SELECT` to `platform_reader`; `platform.record_api_usage(text,text,text,text)` SECURITY DEFINER + grant to `app_user`.

## Migration (M1.13d)
`packages/db/drizzle/0063_legal_hawkeye.sql` (generated as `0054_green_yellowjacket.sql`, renumbered at merge; expand only): `tenancy.api_keys.sandbox boolean NOT NULL DEFAULT false`; hand-written (between `-- hand-written: begin/end`): `api_keys_sandbox_check` added `NOT VALID` then `VALIDATE` (existing table; every existing row is a live key).

## Acceptance

| Criterion | Test |
|---|---|
| Every org/me/session endpoint needs a credential (401 problem+json) | `packages/api-v1/tests/v1.int.test.ts` "every org, me and session endpoint…" |
| Unknown, revoked keys and unknown sessions → 401 | `v1.int.test.ts` "refuses unknown keys…"; e2e `apps/web/e2e/api-keys.spec.ts` "…revokes it (401 after)" |
| Wrong-org key refused; tenant never from a header | `v1.int.test.ts` "never takes the tenant from a header…" |
| Read-only (viewer-scoped) key cannot write; viewer session cannot write | `v1.int.test.ts` "a read-only key cannot write", "a member reads by role…" |
| Idempotent replays; mismatch 422; missing key 400 | `v1.int.test.ts` "creates an event once per Idempotency-Key…", "refunds a ticket… replays"; `packages/kernel/tests/replay.test.ts` |
| Cursor pagination without gaps/duplicates; bad cursor 400 | `v1.int.test.ts` "pages events…", "lists, pages… attendees"; `packages/api-v1/tests/v1.test.ts` (cursors) |
| Allowlisted outputs (no ORM rows, no payment internals) | `v1.int.test.ts` "reads the organization…", "lists and reads orders…"; `v1.test.ts` "wire allowlists" |
| Rate limits per key, 429 + Retry-After; login limits | `v1.int.test.ts` "rate limits per key…", "limits sign-in attempts…"; `v1.test.ts` (token bucket) |
| Request ids | `v1.int.test.ts` "echoes a request id…" |
| Bearer sessions: login, me, orgs, refresh, logout | `v1.int.test.ts` "/v1 user sessions (bearer)" |
| Public event + passes; drafts hidden | `v1.int.test.ts` "serves a published event…" |
| Check-in verdicts (org key and device token), idempotent | `v1.int.test.ts` "scans online…", "/v1 device check-in" |
| API keys: created once/hashed, scopes validated, creator-bounded, isolated per org | `packages/testing/tests/api-keys.int.test.ts`; isolation suite (`api_keys` rows for both orgs) |
| Console: create (shown once, copy), list, revoke, validation messages, keyboard only, empty state, viewer denied, axe, Arabic RTL | `apps/web/e2e/api-keys.spec.ts` |
| Scalar docs load same-origin and list endpoints | `apps/web/e2e/api-keys.spec.ts` "API reference (Scalar)"; `v1.int.test.ts` "serves the OpenAPI document…" |
| oasdiff clean; openapi.json and SDK types current | `pnpm contracts:check`; `oasdiff breaking` against `m0.5-foundation-ey5gqp` (no breaking changes) |
| SDK works against a running API | `packages/sdk/tests/sdk.int.test.ts`; `packages/sdk/tests/schema.test.ts` |
| App-version telemetry per route, readable by staff only | `v1.int.test.ts` "/v1 app-version telemetry"; `apps/admin/e2e/admin.spec.ts` "staff read the commission report … and /v1 API usage", "an organizer account cannot open … the API usage"; `v1.test.ts` (client parsing) |
| HARs match / migrated tokens / store builds on staging | **Not yet** (facade, ELT and staging; see "Later") |
| **M1.13d:** public content reads (sections, announcements, dates, agenda by day in the event timezone, speakers + detail, exhibitors, sponsors by tier, images with absolute hashed URLs, venue directory + venue) | `packages/api-v1/tests/content.int.test.ts` "/v1 public content"; e2e `apps/web/e2e/api-content.spec.ts` |
| Private events, drafts, hidden sections, holders-only and draft announcements, private info, join links, capacities never leave publicly (canary) | `content.int.test.ts` "canary: private events and drafts are 404 everywhere…"; `content.test.ts` "M1.13d wire allowlists"; e2e `api-content.spec.ts` (private agenda 404 via the SDK) |
| Org content reads show the organizer's full view; isolation between orgs; `events:read` needed | `content.int.test.ts` "/v1 org content" |
| Cursor pagination without gaps/duplicates (keyset over the sort key); bad cursor 400 | `content.test.ts` "pageByKey"; `content.int.test.ts` (announcements, dates, speakers, venues pages) |
| ETag + Cache-Control; If-None-Match → 304 | `content.test.ts` "cachedJson"; `content.int.test.ts` "serves visible sections…"; e2e `api-content.spec.ts` |
| Deprecation/Sunset/Link headers from a per-route marker, errors included; none deprecated yet | `content.test.ts` "deprecation marker and middleware"; `content.int.test.ts` "/v1 deprecations" |
| Spectral ruleset passes on the committed spec and catches each rule | `apps/api/tests/spectral.test.ts`; `pnpm contracts:check` |
| Test keys: `yy_test_` prefix, read-only non-personal scopes (command, table CHECK, authorizer), smaller rate limit, prefix tamper → 401 | `content.int.test.ts` "/v1 test keys"; `packages/sdk/tests/sdk.int.test.ts` "reads the agenda (M1.13d)…" |
| Console: Key type (live/test), refused scopes on the field, Test badge in the list, keyboard only, axe, Arabic RTL | `apps/web/e2e/api-keys.spec.ts` "test keys (M1.13d)" |
| API docs list the new endpoints (axe: **not yet**, Scalar's own markup fails it, see Later) | `api-keys.spec.ts` "lists the mobile-ready content endpoints (M1.13d)" |
| SDK smoke: the generated client reads the agenda from the built app | e2e `api-content.spec.ts`; `sdk.int.test.ts` |
| oasdiff clean after the Spectral fixes | `oasdiff breaking` against `m0.5-foundation-ey5gqp`: no breaking changes |

**M1.13d gate (2026-09-28):** `pnpm verify` green (849 unit, 602 integration); `pnpm contracts:check` green (openapi current, Spectral clean, SDK current); oasdiff: no breaking changes. Web e2e: 952 passed, 10 skipped, 4 failed; the 4 failures (`receivables.spec.ts` "a refund after release shows as a receivable…" ×3 projects, `ai-draft.spec.ts` "credits running out between page load and click" desktop) fail identically on the base commit `08077c0`, so they are not M1.13d's.
