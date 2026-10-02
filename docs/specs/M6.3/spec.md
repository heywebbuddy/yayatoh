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
