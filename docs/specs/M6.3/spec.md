# Spec: M6.3 — Public API GA (keys, sandboxes, webhooks, docs)

## M6.3a — Self-serve API keys and sandbox orgs (built)

- **Milestone:** M6.3a (roadmap Phase 6; `docs/plans/phase-6.md` row M6.3A, decisions P6-1, P6-3, P6-13)
- **Status:** Built behind no flag (P6-3 opens `/v1` to every org); sandbox payments are fake-only by construction
- **Risk tags:** db-migration, auth, payments, tenancy
- **Related ADRs:** 0018/0022 (design tokens), 0019 (stack)

### 1. Goal and users
Owners and admins give other software access to their org through `/v1` without asking staff: they
create scoped keys with an expiry, rotate them without downtime, revoke them, and see how each key
is used. Developers get a **sandbox org** linked to their org, with sample data and fake payments,
to build against safely. Rate limits come from the plan's `api_access` entitlement (P6-13).

### 2. What was built
**API keys (tenancy module, extending M1.13)**
- **Lifetimes:** 30, 90 (the console's default) or 365 days, or no expiry (`api_keys.expires_at`).
  An expired key resolves to nothing (`tenancy.api_key_by_hash`) and loses its scopes in the
  authorizer, so it fails on the next request.
- **Scopes:** read/write per resource group (org, events and content, orders and refunds, attendees,
  check-in), as before; a key never holds more than its creator's role.
- **Rotation** (`tenancy.rotateApiKey`, step-up, `api_access`): a new secret with the same name,
  scopes, type and lifetime, shown once; the old key keeps working for 0 h, 1 h, 24 h or 7 days
  (`expires_at`, `replaced_by_id`). A key rotates once (rotate the new one next).
- **Created by** and **expires** columns, statuses Active / Rotated / Expired / Revoked.
- **Creating** a key now needs the `api_access` module (`module_not_enabled` without it). Listing
  and revoking keep `core`, so a downgraded org can still clean up.
- **Daily usage** (`tenancy.api_key_usage_daily`): every `/v1` request made with a key is counted
  per key and per day of the org's timezone: requests, errors (status ≥ 400) and 429s.
- **Audit:** create, rotate and revoke are audited as before (`apiKey.create`, `apiKey.rotate`,
  `apiKey.revoke`); every finished day of a key's use is summarized once as `apiKey.dailyUsage`
  (`day`, `count`, `errors`, `rateLimited`; new allowlisted detail keys) by the worker, hourly.

**Rate limits per entitlement (`/v1`)**
- New module key `api_access` (P6-13), granted to every plan by the migration. `billing.plans`
  gains `quotas` (jsonb); the placeholder `api_access` quotas are 600 requests/minute per live key,
  1,200 per org (every key together), 120 per test key and 300 per key of a sandbox org.
- Each key request takes from its key bucket and the org bucket; `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset` and the new `RateLimit-Policy` (`600;w=60`) describe the
  tighter one; a refusal is a 429 problem+json with `Retry-After`. An org without `api_access`
  gets 403 `module_not_enabled` for every key. Quotas are cached 30 s per org per process.
- `GET /v1/orgs/{org}/api-key` (`getCurrentApiKey`, additive): the calling key's name, prefix,
  scopes, test/sandbox flags, expiry, whether it was rotated, and its per-minute budgets. Never the
  secret. A user session gets 403. SDK regenerated.

**Usage page** (`/o/{org}/api-keys/usage`, owners and admins): totals, a per-day bar chart with the
data as a table, a per-key table (requests, errors, rate limited, last used), last 7/30/90 days.

**Sandbox orgs** (`tenancy.sandbox_orgs`, `organizations.sandbox`, `organizations.sandbox_parent_org_id`)
- `/o/{org}/sandboxes` (owners and admins; permission `sandbox:manage`, entitlement `api_access`):
  create (name), open, delete. At most 10 live sandboxes per org (fixed placeholder).
- Creating: the parent's link row (as the member), then the org row (as the platform, after
  `tenancy.sandbox_parent_of` confirms the link), copying the parent's timezone, country, currency,
  locale and profile. The member becomes its only owner (the parent's other members are not added).
  The web app seeds a published **Sample conference** with a free and a paid ticket type.
- **Fake payments forced** in the payments module: with `PAYMENTS_PROVIDER=stripe`,
  `paymentProviderFromEnv` returns `sandboxSafeProvider`, which sends every money call of a sandbox
  org (and every object the fake minted) to the fake provider, and fails closed if no fake is
  configured. A fake-signed webhook is accepted on a Stripe deployment for sandbox orgs only; the
  order records the provider that actually took the payment (`CreatePaymentResult.provider`).
- **Never on the marketplace:** `isOnMarketplace` is false for a sandbox org's events, and
  `marketplace.updateSiteSettings` refuses `listOnMarketplace` for a sandbox (`sandbox_org`). Its
  own tenant site still lists its events.
- **SANDBOX banner** on every console page of a sandbox org (`OrgStatusBanner`).
- **Deleting** (step-up): the link is marked deleted, then the sandbox is closed (`terminated`,
  recorded in `org_status_changes` and announced as `org.status_changed@1`, so its pages go offline
  and listings drop), every membership is removed and every key revoked. Its fake data stays inert
  (ledgers are append-only); a purge job is later work.
- A sandbox can't have sandboxes.

### 3. Data model and migration (`packages/db/drizzle/0102_fast_tinkerer.sql`)
| Table | Change |
|---|---|
| `tenancy.api_keys` | add `expires_at`, `replaced_by_id` |
| `tenancy.api_key_usage_daily` | new tenant table (unique org, key, day; composite FK to the key) |
| `tenancy.sandbox_orgs` | new tenant table, owned by the parent (unique `sandbox_org_id`) |
| `tenancy.organizations` | add `sandbox`, `sandbox_parent_org_id`; CHECK (NOT VALID, then VALIDATE) |
| `billing.plans` | add `quotas` jsonb; CHECK (NOT VALID, then VALIDATE) |
Hand-written: `tenancy.api_key_by_hash` recreated (excludes expired keys; returns `expires_at`,
`org_sandbox`), `tenancy.sandbox_parent_of(uuid)` (SECURITY DEFINER, `app_user` EXECUTE), the
`api_access` row in `billing.plan_modules` for every plan and the placeholder quotas. Expand only.

### 4. Later / not yet
- Purging a deleted sandbox's data (needs a retention job that respects append-only ledgers).
- Plan-dependent key and sandbox counts (fixed 10 sandboxes today; no key count cap).
- A distributed rate limiter (Upstash adapter; the in-memory one serves one instance) and a daily
  request quota.
- Copying the parent's brand kit or real events into a sandbox; inviting teammates is the normal
  team page inside the sandbox.
- The sandbox's public event pages carry no "sandbox" notice yet (the marketplace never lists them).
- Webhooks GA, public docs and the npm SDK publish are M6.3b.

### 5. Acceptance
| Criterion | Test |
|---|---|
| A key can't exceed its scopes (generated from the OpenAPI document: every org operation, a key without the documented scope never succeeds, reads are exactly 403) | `packages/api-v1/tests/keys.int.test.ts` › generated |
| A key can't exceed its org (every org operation with another org's key is 404) | `packages/api-v1/tests/keys.int.test.ts` › generated |
| A revoked key fails on the next request | `packages/api-v1/tests/keys.int.test.ts`, `apps/web/e2e/api-keys-sandboxes.spec.ts` |
| Expiry and rotation (overlap, no overlap, test keys, step-up, permissions, other org) | `packages/testing/tests/api-keys-sandbox.int.test.ts`, `packages/api-v1/tests/keys.int.test.ts`, e2e |
| Rate-limit headers are correct (limit, remaining countdown, reset = Retry-After, policy, org budget, no `api_access` → 403) | `packages/api-v1/tests/keys.int.test.ts`, `packages/api-v1/tests/quotas.test.ts`, e2e |
| Usage per day and per key, errors and 429s; daily audit summary once | `packages/testing/tests/api-keys-sandbox.int.test.ts`, `packages/api-v1/tests/keys.int.test.ts`, e2e usage page |
| A sandbox org can never take real money (PAYMENTS_PROVIDER=stripe forced on; live provider never called; fails closed; fake webhooks only for sandboxes) | `packages/testing/tests/sandbox-payments.int.test.ts` |
| A sandbox can't be on the marketplace | `packages/modules/marketplace/tests/domain.test.ts`, `packages/testing/tests/api-keys-sandbox.int.test.ts` |
| Isolation (new tables have rows for both fixture orgs; other orgs can't list or delete a sandbox, read usage) | isolation suite via `createOrgFixture`, `api-keys-sandbox.int.test.ts` |
| E2E: create, use (request), rotate, revoke a key; create, open, use and delete a sandbox; keyboard only; axe; Arabic RTL; viewer can't create keys or see usage/sandboxes; empty states | `apps/web/e2e/api-keys-sandboxes.spec.ts`, `apps/web/e2e/api-keys.spec.ts` |
| `/v1` additive; Spectral clean; SDK regenerated | `pnpm contracts:check` |

## M6.3b — Webhooks GA and developer docs (built)

- **Milestone:** M6.3b (roadmap Phase 6, §6.3; `docs/plans/phase-6.md` row M6.3B, decisions P6-1, P6-3, P6-13; D21)
- **Status:** Built behind the provider port: Svix when `SVIX_API_KEY` is set (owner inbox), the fake publisher everywhere else outside production; no publisher in production until then
- **Risk tags:** db-migration, tenancy, infra (CI jobs)

### 1. Goal and users
Owners and admins send their org's events to their own systems: they add https endpoints, choose
the events, check delivery with a test send, see each delivery, replay what failed, and verify
signatures with documented, tested code. Developers find everything on a public docs site: guides,
the API reference generated from OpenAPI, and the event catalog. The TypeScript SDK is built for npm
(dry run) with typed webhook messages; Swift and Kotlin clients are generated as CI artifacts.

### 2. What was built
**Event catalog** (`@yayatoh/webhooks`, tier 6, `src/catalog.ts`)
- 31 public types: orders (`order.paid`, `order.refunded`, `order.expired`, `order.payment_failed`,
  `order.disputed`, `order.dispute_closed`), tickets (`tickets.cancelled`, `ticket.transferred`,
  `ticket.claimed`), check-in (`ticket.admitted`, `ticket.admission_undone`), events (`event.created`,
  `event.published` … `event.archived`, `event.updated`, `event.occurrence_cancelled`,
  `ticket_type.created|updated|archived`), registration (`form.registration_submitted`,
  `waitlist.joined`, `waitlist.offered`), engagement (`survey.responded`, `review.submitted`,
  `program.agenda_published`) and `webhook.test`. Each has a versioned Zod schema (`v1`), a summary,
  a description and an example; renamed fields map explicitly (`formVersion`, `agendaVersion`).
- Every other outbox event is in `INTERNAL_EVENTS` with a reason (personal, security, workflow,
  platform, content, later). A test scans all source for emitted (`type:`/`version:`) and named
  (`'x.y@N'`) outbox keys and fails on any event that is in neither list, in both, or stale.
- **Thin payloads (D21):** field names come from `THIN_FIELDS`; every string is a uuid, date,
  date-time, enum, constant or short bounded pattern (checked on the JSON Schema). Serialization is
  the allowlist: `toPublicData` parses the internal payload through the schema, so extra keys
  (contact ids, emails, answers) are dropped, and a payload that does not fit throws instead of
  being sent.
- Envelope: `{ id, type, version, apiVersion: 'v1', occurredAt, orgId, data }`; `id` is the outbox
  event id (Svix dedupes on it; receivers dedupe on `webhook-id`).
- The catalog is in the OpenAPI document's top-level `webhooks` (31 operations, `<Schema>Message`
  components, tag `webhooks`), additive (paths and existing components unchanged; Spectral clean).

**Provider port** (`WebhookPublisher`): application = org, endpoint uid = our row id, message
eventId = outbox id, so every call is retry-safe.
- `svixPublisher`: Svix REST over fetch (apps, event types with JSON Schema and example, endpoints,
  secrets and rotation, messages with idempotency key, send-example, attempts, resend, recover, app
  portal access). Errors map to `not_found` / `invalid` / `unavailable`, never Svix's text.
- `fakePublisher`: in-process store; signs every delivery exactly like Svix (Standard Webhooks,
  checked against the spec's test vector) and records it instead of sending (no network, no SSRF in
  CI). A URL path segment `fail` answers 503 to exercise retries (Svix's schedule: 5 s, 5 min,
  30 min, 2 h, 5 h, 10 h, 10 h), resend and recovery. Secrets derive from a seed; rotation keeps
  the old one signing 24 h. Portal links are HMAC-signed, ten minutes, one app.

**Endpoints** (`webhooks.endpoints`, tenant table, RLS forced): the mirror of Svix's endpoints
(url, description, event types, active/paused, creator). Commands (all `webhooks:manage`, owners
and admins; module `api_access`): create, update (URL, description, types, pause), delete, reveal
secret (audited), rotate secret (step-up), test send (`webhook.test` or any type's example, one
endpoint only), resend a message, recover failures since a time (≤ 14 days). Queries: list, get,
attempts, portal link. URLs: https on 443, no credentials, public names and addresses only
(`@yayatoh/platform/ssrf` at registration; Svix re-checks at send). At most 20 endpoints per org.
Audit entries name the host, never the URL's path (it can hold the receiver's token).

**Publishing:** subscriber `webhooks.publish` (worker registry) sends each catalog event to the org's
endpoints, skipping orgs without an active endpoint or without `api_access`, and replayed history.
Dev/CI: `POST /api/dev/webhooks/drain` runs it for one org (separate from the message drain, so the
shared e2e org's message events keep their window) and the fake's due retries.

**Console** (`/o/{org}/webhooks`, linked from API keys): endpoint list with status and event count,
add form (URL, description, all or chosen events by group); endpoint page with test send, signing
secret (show, copy, hide, rotate with "Confirm it's you"), recent deliveries (time, event, status,
response, trigger, next retry, Resend), recover failed messages, settings (pause), delete. The
embedded portal (`/o/{org}/webhooks/portal`) frames Svix's App Portal (its origin is added to that
page's `frame-src` only when Svix is configured; dev and CI headers are unchanged) or the fake
same-origin portal (`/webhook-portal/{token}`, 404 wherever the fake is off). The console pages are
the keyboard and screen-reader path. 13 locales, Arabic RTL.

**Developer docs** (`/developers`, public): overview with search (instant results as you type,
server-rendered results without JavaScript at `/developers?q=`), guides (API keys, pagination,
idempotency, webhooks and signature verification, sandbox orgs), the API reference generated from
the `/v1` OpenAPI document (every operation by tag: method, path, summary, parameters, body,
responses; links to the interactive Scalar reference and `openapi.json`), and the event catalog
(fields, types and an example message per event). The shell is translated in every locale; guide
and reference content stays English (`lang="en"`, left to right).

**Signature verification:** the docs' Node example (`examples.ts`) is executed by a unit test
against the spec's test vector and against deliveries the fake signed (tampering, stale timestamps
and missing headers refused). The SDK has `verifyWebhook` (Web Crypto) and `WebhookMessage<T>`.

**SDK pipeline:** `build:npm` (ES2022 + declarations + publish-ready manifest, no workspace deps),
`publish:dry-run`; CI jobs `sdk-npm` (dry-run publish, `dist` artifact) and `sdk-mobile`
(openapi-generator Swift 6 and Kotlin, artifacts only). SDK 0.4.0.

### 3. Later / not yet
- A "full payload" mode per endpoint for non-personal events; more public events (the `later` ones).
- `/v1` webhook endpoint management for integrations (Zapier REST hooks, M6.4) and a
  `webhooks:manage` API scope.
- Endpoint health alerts in the Command Center (`integration.connection_error`), auto-disable on
  410 surfaced in the console (Svix does it; we do not mirror it yet).
- The real npm publish and the mobile SDK publish (owner token; mobile build).
- The legacy `/api/v2` facade is untouched.

### 4. Acceptance
| Criterion | Test |
|---|---|
| Every public event has a documented, versioned schema; the catalog covers every public outbox event | `packages/modules/webhooks/tests/catalog.test.ts` (scan, classification, docs, examples); `apps/web/tests/developer-docs.test.ts` (OpenAPI `webhooks` = catalog); `apps/web/e2e/developers.spec.ts` (catalog page) |
| A payload never carries PII beyond D21's thin set (leak canary) | `catalog.test.ts` (thin fields, bounded strings, canary payloads, refusal); `packages/testing/tests/webhooks.int.test.ts` (whole fixture history + planted PII published thin) |
| Signature verification documented and tested with the example code | `packages/modules/webhooks/tests/signing.test.ts` (docs example vs spec vector and fake deliveries); `packages/sdk/tests/webhooks.test.ts`; `developers.spec.ts` (guide shows the code) |
| Isolation | `webhooks.int.test.ts` (another org: list, get, attempts, update, reveal, rotate, test, delete; RLS rows); `fake.test.ts` (apps apart); `isolation.int.test.ts` (fixture rows for both orgs) |
| Svix port with fake in CI: portal, retries, replay, secret per endpoint, test send | `fake.test.ts`, `svix.test.ts`, `webhooks.int.test.ts`; `apps/web/e2e/webhooks.spec.ts` |
| E2E: add an endpoint, test-send, see the delivery (fake) | `webhooks.spec.ts` (happy path, real outbox event via the drain, failing receiver with resend/recover, secret, pause, validation, keyboard, portal, viewer denial, Arabic, axe) |
| Docs pages render with a working search; keyboard only, axe, RTL | `developers.spec.ts` (search with and without JS, keyboard and skip link, guides, reference, catalog, Arabic, axe) |
| SDK publish pipeline (dry run); Swift/Kotlin generated | `packages/sdk/tests/npm-package.test.ts` (manifest, plain-JS import, NodeNext consumer type-check); CI `sdk-npm`, `sdk-mobile` |
| `/v1` additive, contracts clean | `pnpm contracts:check`; semantic diff: paths and existing components unchanged |
