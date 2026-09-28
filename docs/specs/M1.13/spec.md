# M1.13 — `/v1` core API, docs and TypeScript SDK

Roadmap: M1.13 ("`/v1` per §6.1; mobile auth; `/v1/mobile/config`; scanner endpoints … Scalar docs; the TypeScript SDK") and the `/v1` half of M1.15 ("mobile-ready endpoints … generated TS/Swift/Kotlin SDKs … app-version telemetry per route"). ADRs 0002 (one command model), 0003 (RLS), 0010 (auth), 0014 (allowlists).

- **Risk tags:** `auth`, `tenancy`, `db-migration`, `mobile-contract` (additive `/v1` only).
- **Not in this milestone:** the legacy `/api/v2` facade (frozen; needs the golden HARs from the owner's apps, see "Facade needs" below).

## M1.13a — core resources (done)

**One router, two mounts.** `packages/api-v1` (`createV1(deps)`) is mounted by `apps/api` at `/v1` (api.yayatoh.com) and by the web app at `/api/v1` (same-origin for the Scan PWA and local API clients). The scanner routes from M1.9 are part of it.

**Authentication** (no cookies on `/v1`; `Authorization: Bearer …` only):
- **Org API keys** `yy_live_<43 base64url>`: `tenancy.api_keys` (tenant table, FORCE RLS). Only a SHA-256 of the key is stored; the key is shown once. The key resolves to (org, key, scopes) through the SECURITY DEFINER `tenancy.api_key_by_hash`, which returns nothing for revoked keys and for suspended or terminated orgs. Last use is stamped at most once a minute.
  - **Scopes** (`API_KEY_SCOPES`): `org:read`, `events:read`, `events:write`, `orders:read`, `orders:refund`, `attendees:read`, `checkin:scan`; M1.13d adds `attendees:write`. The authorizer lets an `api_key` actor do exactly what its **live** scopes list (a revoke applies to the next request). A key never gets more than its creator's role (`scope_exceeds_role`), and never member-management or payout powers.
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

## M1.13d — bulk actions on `/v1` (done)
The M1.8 bulk-action framework (M1.8b/e/f) through `/v1/orgs/{org}/…`, additive only (oasdiff: no breaking changes). **Risk tags:** `auth`, `tenancy`, `db-migration`, `payments`-adjacent (cancel without refund).

**Same commands as the console.** Each kind is one registered bulk action, and `/v1` runs its own `start`, `undo` and `status` commands from `bulkCommands(action)` (`packages/api-v1/src/routes/bulk.ts`). So the permission (the key's scopes or the member's role, including event-scoped roles), the entitlement, step-up, the M1.2e category, the M1.3f org gate, the `bulk.start` / `bulk.undo` audit rows (actor `api_key:<id>` or `user:<id>`, the request id) and the outbox events are the console's. Starts and undos run with `idempotent: true`.

| Method + path | What | Scope / permission |
|---|---|---|
| `POST /v1/orgs/{org}/events/{eventId}/bulk/labels` | add/remove labels (`add`, `remove`) | `attendees:write` |
| `POST …/bulk/emails` | email attendees (`subject`, `body`) | `attendees:write` |
| `POST …/bulk/seat-assignments` | seat them (`target`: item, section, best, group; `overrideRules`) | `events:write` |
| `POST …/bulk/ticket-resends` | resend tickets | `attendees:write` |
| `POST …/bulk/ticket-cancellations` | cancel tickets without a refund (explicit `ids` only) | `orders:refund` |
| `GET /v1/orgs/{org}/bulk/{kind}/{operationId}` | progress and results | the kind's |
| `POST /v1/orgs/{org}/bulk/{kind}/{operationId}/undo` | undo (`labels`, `seat-assignments`; once, within 10 minutes) | the kind's |

- **Selection:** `{ ids: [...] }` (1–50,000 attendees of the event; a foreign or unknown id refuses the whole request with 404) or `{ filter: { search, labels, source, status } }` (the list's attendee filters, resolved once when the operation starts). Ticket-type and check-in filters are not offered: they would have to be resolved to ids in the transport, which would make an idempotent retry's input depend on when it runs. Callers select by ids for those.
- **Cancel** takes ids only: it can't be undone, so the caller names exactly who (the console's confirmation count, M1.8f, plays that role there).
- **Responses:** starts and undos are `202` with the `BulkOperation` after up to 3 s of inline work (`V1Deps.bulkInlineMs`, like the console); the worker's leader finishes anything bigger (it registers every one of these actions). `BulkOperation` (allowlist): `id`, `kind`, `eventId`, `status`, `total`, `processed`, `succeeded`, `failed`, `undone`, `createdAt`, `finishedAt`, `undoUntil`, and the first 50 `failures` and `warnings` as `{ attendeeId, code }`. Never the params (message bodies), the item ids or the requester.
- **Idempotency:** a retry with the same `Idempotency-Key` returns the same operation (the start command's stored output); another body with that key is 422; no key is 400. The fingerprint is the command input, which is fully determined by the request (hence filters are passed to the command as they are).
- **Kinds are separate:** an operation read or undone under another kind's path is 404 (the status command loads by id *and* action).
- **Exports** (attendee, bookings, audit, DSAR) are not offered: they need a step-up, which no `/v1` credential carries (API keys have no person; bearer sessions are long-lived). Pending the owner.
- **New API key scope `attendees:write`** ("Change attendees and resend tickets", 13 locales: `apiKeys.scope.attendees_write`). Pending the owner.
- **SDK:** regenerated (`BulkOperation`, `BulkSelection`, the request schemas). `packages/sdk/tests/sdk.int.test.ts` starts, polls and undoes an operation through it.

**Migration** `packages/db/drizzle/0060_flimsy_talos.sql` (renumbered at merge; shared with M1.3's restore): widens `tenancy.api_keys_scopes_check` (+ `attendees:write`) and `tenancy.org_status_changes_action_check` (+ `restore`). Generated as drop + add; hand-edited (`-- hand-written` block) to add both `NOT VALID` and then `VALIDATE`, plus two header lines. No new tables.

## Later / not yet
- **The `/api/v2` facade (§6.2)** and M1.13's HAR acceptance: needs the golden HARs from both store builds (owner inbox, M0.3) and the M0.8 route list. It will need: a Hono sub-app at `apps/web/app/api/v2/[...route]`, host-namespaced instances, `compat_ids`, Sanctum token lookup (`packages/auth/compat/sanctum.ts` is ready) against migrated `personal_access_tokens` (M2 ELT), per-route × app-version × instance telemetry (the `platform.api_usage` pattern plus an instance column) and a kill switch per route.
- **"Migrated tokens work without re-login"**: needs the migrated Sanctum tokens (M2 ELT) and `/v1/auth/legacy-exchange`; not buildable before the ELT.
- **"Store builds complete login → buy → ticket → scan on staging"**: needs staging and the facade.
- **15-minute JWTs with rotating 60-day refresh families (PKCE, reuse detection)**: sessions are Better Auth's 14-day sliding sessions for now; do this before a mobile build ships.
- **Step-up for creating API keys** (ADR 0010): there is no step-up flow in the web yet (`stepUp` is unused everywhere); add it with the step-up UI.
- **Test keys** (`yy_test_…` mapped to a linked sandbox org in Stripe test mode); per-key event lists; key expiry.
- `X-Yayatoh-Client` 426 handshake against `minimumVersions` (config is served; enforcement arrives with a mobile build); `Deprecation`/`Sunset` headers; Spectral lint; bracket filters, `expand[]`, sparse fields.
- Mobile endpoints for wallet passes, checkout sessions, seat map, RSVP and agenda: their features are not built yet (M4.7, M5.x); scanner manifest/lookup/device commands beyond M1.9's.
- Upstash rate-limit adapter (owner account).

## Migration
`packages/db/drizzle/0039_graceful_dexter_bennett.sql` (expand only):
- new tenant table `tenancy.api_keys` (FORCE RLS, canonical policy, org FK, global unique `key_hash`, name/scope CHECKs);
- new global table `platform.api_usage` (listed in `GLOBAL_TABLES`);
- hand-written (between `-- hand-written: begin/end`): `tenancy.api_key_by_hash(text)` SECURITY DEFINER + grant to `app_user`; `REVOKE ALL` on `platform.api_usage` from `app_user` and `platform_reader`, `GRANT SELECT` to `platform_reader`; `platform.record_api_usage(text,text,text,text)` SECURITY DEFINER + grant to `app_user`.

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
| **M1.13d** Bulk labels by ids with a key: 202, done inline, allowlisted output, audited as the key with the request id; status per kind (another kind's path 404); undo once (second 409) | `packages/api-v1/tests/bulk.int.test.ts` "labels by ids with an API key…" |
| M1.13d One operation per Idempotency-Key (retry replays, other body 422, none 400) | `bulk.int.test.ts` "one operation per Idempotency-Key…" |
| M1.13d Resend (`no_ticket` failures, one resend event per chunk), email (body not audited, wire validation), seat assignment + undo, cancel (ids only, tickets void, no undo route) | `bulk.int.test.ts` |
| M1.13d Scopes and roles: read-only key 403 on every kind and on status; viewer 403; manager labels (audited as the user) but can't cancel; no credential 401 | `bulk.int.test.ts` "respects scopes and roles…" |
| M1.13d Tenant isolation: another org's key 404 on the path, the event's ids, the operation and its undo; the entitlement (`module_not_enabled`) | `bulk.int.test.ts` "isolates tenants…", "needs the module…" |
| M1.13d Through the SDK: start with a key, same key same operation, poll, undo, another org 404 | `packages/sdk/tests/sdk.int.test.ts` "runs a bulk action…" |
| M1.13d In the browser: a key made with the new scope labels guests through `/api/v1`, polls, undoes, the console shows it; a read-only key 403 | `apps/web/e2e/api-bulk.spec.ts` |
| M1.13d oasdiff clean; openapi.json and SDK current; the scope in 13 locales | `pnpm contracts:check`; `oasdiff breaking` against the base (no breaking changes); `apps/web/tests/messages.test.ts` |
