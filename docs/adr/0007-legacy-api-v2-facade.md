# ADR 0007 — Legacy `/api/v2` facade: frozen, allowlisted, host-namespaced, no sunset while mobile is deferred

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §6.2, §8.3)

## Context
- The current Yayatoh and ABC store apps call `/api/v2` on the legacy Laravel app.
- The owner decided mobile apps are planned but **not built in this build** (decision log 2026-09-26). The current builds must keep working.
- Legacy responses are quirky and some leak private fields (roadmap §1.3, §1.3b).

## Decision
- `packages/legacy-v2` is a Hono sub-app mounted at `apps/web/app/api/v2/[...route]`, plus legacy payment returns, `/stripe/webhook` and transactional URL handlers.
- **Host-namespaced:** the instance (`yayatoh` | `abc`) comes from the Host header only. Integer IDs come from `compat_ids`, scoped by instance.
- **Byte-level wire compatibility** reproduced per route from golden HARs: paths, methods, status codes, snake_case keys, paginator envelope, error bodies, string decimals, 0/1 flags, date formats, nulls.
- **Allowlisted:** fields leaked today are dropped. Only fields the apps read (verified from source and HAR) are returned.
- **No business logic:** handlers call the same commands as `/v1`.
- **Sanctum:** split on the first `|`, look up `(instance, id)`, `timingSafeEqual(sha256(rest), stored)`; `/api/v2/login` mints Sanctum-format tokens.
- Scan endpoints accept legacy and yy1 payloads.
- Per route × app version × instance telemetry and a kill switch per route.
- **Frozen:** changes need an updated golden HAR plus owner approval.
- **No sunset** while the mobile build is deferred.

## Alternatives
- **Keep Laravel running for the apps.** Rejected: two systems of record.
- **Force an app upgrade.** Rejected: no mobile build in this build.

## Consequences
- Twin-snapshot differential tests target 0 unexplained diffs; a contract gate runs in CI.
- The route list is final at M0.8.
- Any change to the facade is a `mobile-contract` PR needing owner approval.
- The §7.6 sunset timeline applies only once a future mobile build ships.

## Revisit when
- A mobile build is scheduled (D5) and new apps reach the adoption thresholds in roadmap §7.6.
