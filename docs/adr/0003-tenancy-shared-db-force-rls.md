# ADR 0003 — Tenancy: shared DB, `org_id`, FORCE RLS, `withTenant`, DB roles, isolation suite as merge gate

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §4.3)

## Context
- Yayatoh 2.0 is multi-tenant and white-label. Organizers, agencies and venues share one platform.
- The legacy app leaked organiser bank and tax data. Isolation must hold in depth, not by convention.
- The tenant comes from the host or path, checked against the actor's effective orgs. Headers are never trusted.

## Decision
- **Shared database, shared schema per module.** Every tenant-owned table carries `org_id`.
- `tenantTable()` adds:
  - `org_id uuid NOT NULL` and `UNIQUE(org_id, id)`
  - composite foreign keys and indexes that lead with `org_id`
  - `ENABLE` + `FORCE ROW LEVEL SECURITY`
  - policy `org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)`. The `(SELECT …)` wrapper avoids a ~575× regression. `NULLIF` avoids a cast error on pooled connections.
- `eventTable()` adds a RESTRICTIVE event-scope policy for event-role-only actors. Money tables add a RESTRICTIVE direct-member policy.
- **All access goes through `withTenant(ctx, …)`**, which sets context with `set_config(…, true)` inside the transaction (safe with PgBouncer transaction pooling). No raw DB client outside `packages/db`.
- **Roles:**
  - `app_user`: runtime, NOBYPASSRLS
  - `migrator`: schema owner, direct connection
  - `public_reader`, `marketplace_writer`: marketplace schema only
  - `ledger_writer`: owns `post_journal`
  - `platform_reader`: BYPASSRLS; `apps/admin` and `apps/worker` only; every use audited
- Cache keys and tags include the org.
- **Isolation suite (blocking merge gate):** schema guard, role guard, no-context test, generated two-org tests per command/query, generated `/v1` foreign-ID 404 tests, cache guard, job guard, Ably capability tests, presigned-URL prefix tests, canary leak test.

## Alternatives
- **Database per tenant.** Rejected at launch: cost and migration overhead. `shard_key` on organizations keeps the seam.
- **App-level filtering only.** Rejected: one missed `where` leaks data.

## Consequences
- A table without RLS fails CI (M0.5 gate canary).
- Every new table must be registered in the isolation fixtures.
- M0.6 acceptance: RLS p95 overhead under 10% on a 1M-row table.
- Cross-tenant reads (marketplace) come only from `marketplace.public_listings`, which holds no PII.

## Revisit when
- A tenant needs a dedicated database for scale or contract reasons.
- RLS overhead exceeds the M0.6 budget.
