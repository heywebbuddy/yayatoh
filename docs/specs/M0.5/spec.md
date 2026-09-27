# M0.5 — Monorepo, operating model and CI gates

**Roadmap:** §8 Phase 0 → M0.5; layout §3.4; rules §3.5; gates §9.
**Risk tags:** `infra`, `tenancy` (owner approval).

## Goal
A monorepo that every later increment builds on, where the non-negotiable rules in CLAUDE.md are enforced by code and CI rather than by memory.

## Scope
**In:** Turborepo + pnpm 12 workspace; `apps/web` (Next.js 16.3, React 19.3, Tailwind 4.3, next-intl 4.14, 13 locales), `apps/api` (Hono 4.13 + zod-openapi, `/v1/health`, OpenAPI 3.1), `apps/worker` (pg-boss 12); `packages/config|kernel|db|contracts|ui`; `tools/check-modules`; Biome 2.5; Vitest 5; TypeScript 6.0.3 (ADR 0019); docker-compose; GitHub Actions; `.env.example`; ADR set; spec and PR templates; Renovate; gitleaks.

**Out (moved to later increments):** module generator (`turbo gen`, lands with the first module in M0.6); PDF spike (ADR 0017 stays Proposed); axe, bundle-budget and Playwright gates (land with the first real screens in M1.1); canary *leak* crawl (needs public routes; M0.6); oasdiff runs from this PR on, against an empty base.

## Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC1 | Given the repo, when `pnpm verify` runs, then lint, check-modules, typecheck, unit and integration all pass | CI `checks` + `integration` jobs |
| AC2 | Given a module importing another module's `./schema`, a relative reach-in, or a lower tier importing a higher one, then check-modules fails | `tools/check-modules/tests/check.test.ts`, CI `gate-canaries` |
| AC3 | Given a table defined without `tenantTable()`, then check-modules fails **and** the schema guard reports it (no RLS, not forced, no policy, no org index) | `check.test.ts` › table without RLS; `packages/db/tests/tenancy.int.test.ts` › gate canary |
| AC4 | Given a `tenantTable`, when rows exist for two orgs, then each tenant sees only its own rows, cross-tenant writes fail, and `app_user` with no tenant sees 0 rows and cannot insert | `tenancy.int.test.ts` › isolation |
| AC5 | `app_user` is not a superuser, cannot bypass RLS and owns no tables | `tenancy.int.test.ts` › role guard |
| AC6 | `executeCommand` runs validate → entitlement → authorize → step-up → idempotency → tx → handler → outbox → audit → serialize, in order, and returns only allowlisted fields | `packages/kernel/tests/command.test.ts` |
| AC7 | Money is integer minor units; allocation never loses a unit; bps use half-even rounding | `packages/kernel/tests/money.test.ts` |
| AC8 | `GET /v1/health` returns the allowlisted DTO; `/v1/openapi.json` is OpenAPI 3.1; the committed spec is current | `apps/api/tests/app.test.ts`, `pnpm contracts:check` |
| AC9 | pg-boss runs a job on Postgres 18; a tenant job without `orgId` is rejected | `apps/worker/tests/*.test.ts` |
| AC10 | UI tokens match ADR 0018 in both `tokens.ts` and `styles.css`; buttons are pills with ≥24 px targets; tables use logical alignment | `packages/ui/tests/*` |
| AC11 | All 13 locales have exactly the English keys; `ar` renders `dir="rtl"` | `apps/web/tests/messages.test.ts`, build output |
| AC12 | No secrets in history | CI `gitleaks` |

## Demo
1. `docker compose up -d && pnpm install && pnpm verify` → all green.
2. `pnpm dev`, open http://localhost:3000 and http://localhost:3000/ar (RTL); `curl localhost:4000/v1/health`.
3. `node tools/check-modules/cli.ts --root tools/check-modules/canaries/cross-module-import` → rejected.
