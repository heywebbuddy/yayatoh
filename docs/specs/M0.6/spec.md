# M0.6 — Tenancy, outbox and entitlement kernel

**Roadmap:** Phase 0 → M0.6; §4.1, §4.3, §4.5, §3.3; ADRs 0003, 0008, 0013.
**Risk tags:** `db-migration`, `tenancy` (owner approval).

## Goal
The walking-skeleton kernel that every module builds on: organizations and memberships, the command pipeline wired to Postgres (outbox, audit, idempotency), entitlements, the profiles registry and the isolation suite as a merge gate.

## Scope
**In:**
- `tenancy`: organizations and memberships, with commands to create/update orgs and add/change/remove members, plus the authorizer.
- `billing`: plans and `launch_standard`, overrides, effective entitlements.
- `platform`: outbox, processed events, audit events, idempotency keys, command ports, module keys, profiles and navigation.
- Worker: a single-leader relay with gap-free `log_seq` feeding pg-boss.
- `packages/testing`: the two-org fixture and the isolation suite.

**Out (later):**
- Better Auth users and sessions → M1.2. Memberships reference `user_id` without a foreign key until then.
- Host resolution in `proxy.ts` and theme CSS variables → M1.1 (shell) and M1.3 (white-label).
- Admin shell → M1.x.
- Audit hash chain and Object Lock → M1.2 security increment.
- Redis entitlement cache → when Upstash exists (owner inbox M0.1). Entitlements are currently read on every check.
- RLS p95 overhead benchmark on a 1M-row table → nightly suite.

## Data model (migrations `0000`, `0001`)
- **`tenancy.organizations`:** `org_id = id` (CHECK) and a global unique slug.
- **`tenancy.memberships`:** one per org and user, role CHECK, foreign key to the org.
- **`billing.plans` and `billing.plan_modules`:** global reference data; `app_user` has SELECT only. `billing.org_plans` and `billing.entitlement_overrides` are tenant tables.
- **`platform.domain_events`, `processed_events` and `audit_events`:** append-only for `app_user`. `platform.idempotency_keys` expires after 24 h.
- **SECURITY DEFINER functions:**
  - `tenancy.resolve_org_slug` and `tenancy.user_memberships` (`app_user`)
  - `platform.relay_stamp`, `relay_pending` and `relay_mark_published` (`platform_reader` only)
- **Bootstrap:** functions are private by default (`REVOKE EXECUTE … FROM PUBLIC`).

Every table uses `tenantTable()`, except the two plan catalogs, which are listed in `GLOBAL_TABLES`.

## Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC1 | Given the migrated schema, the schema guard and role guard report nothing | `packages/testing/tests/isolation.int.test.ts` |
| AC2 | Given the two-org fixture, every tenant table has rows for both orgs (new tables must be registered) | isolation › fixture covers every tenant table |
| AC3 | As `app_user` in org A, raw SQL sees 0 rows of org B in every tenant table | isolation › raw SQL |
| AC4 | With no tenant context, every tenant table returns 0 rows, inserts fail, and `withTenant` refuses | isolation › missing tenant context |
| AC5 | Creating an org makes the creator its owner, emits `organization.created@1` and writes an audit row | `tenancy.int.test.ts` |
| AC6 | A non-member is forbidden, a viewer can read but not manage, and the last owner cannot be removed or demoted | `tenancy.int.test.ts` |
| AC7 | An idempotent command replays its stored result; the same key with a different request returns 422 | `tenancy.int.test.ts` › idempotency |
| AC8 | Every org starts on `launch_standard`. Revoking a module hides its nav item and returns `module_not_enabled` without a deploy; only a platform actor can change entitlements | `tenancy.int.test.ts` › entitlements |
| AC9 | Two racing relays produce one gap-free `log_seq` (1..n); every event is published and delivered once to each matching subscriber | `apps/worker/tests/relay.int.test.ts` |
| AC10 | Consumers are idempotent under replay | relay › consumers are idempotent |

## Demo
1. `pnpm verify`.
2. `pnpm db:bootstrap && pnpm db:migrate && pnpm seed` → two orgs.
3. `pnpm --filter @yayatoh/worker dev` → the relay publishes the seed's events (see `platform.domain_events.log_seq`).
