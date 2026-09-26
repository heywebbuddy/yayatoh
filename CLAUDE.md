# Yayatoh 2.0 — agent guide

This repo is Yayatoh 2.0, a multi-tenant, white-label **Event Operating System**. It replaces the Laravel/Eventmie Pro platform behind yayatoh.com and abc.yayatoh.com.

Claude Code builds it; the owner (Pani Digital Services, LLC) is product owner and reviewer.

## Read first
- `docs/roadmap.md`: the approved build plan. It covers phases, milestones (M0.x…M6.x), architecture, domain model and decisions.
- `docs/vision.md`: the owner's vision, in their own words.
- `docs/decisions.md`: the decision log. `docs/owner-inbox.md` lists tasks only the owner can do.
- `docs/legacy/`: the legacy code audit and the M0.0 security hotfix list.
- `docs/research/`: background research. Files marked "superseded" are overridden by the roadmap.

**Precedence when documents disagree:** owner decisions (`docs/decisions.md`, roadmap §1.4) > accepted ADRs (`docs/adr/`) > `docs/roadmap.md` > `docs/research/`.

## Current phase
**Phase 0 — Discovery and foundations.** The repo currently holds docs only. M0.5 bootstraps the monorepo (Turborepo + pnpm, `apps/*`, `packages/*`, CI gates), and this file gains a **Commands** section at that point.

## Non-negotiable rules (all phases)

**Tenancy** (roadmap §4.3)
- Every tenant-owned table has `org_id NOT NULL`, **ENABLE + FORCE row-level security**, and the policy `org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)`.
- Every such table also has indexes that lead with `org_id`, composite foreign keys, and uniques scoped to the org.
- All database access goes through `withTenant(ctx, …)`. No raw DB client outside `packages/db`.
- The tenant comes from the root param or the session/token, **never from request headers**. Cache keys and tags include the org.
- `platform_reader` (which bypasses RLS) is used only in `apps/admin` and `apps/worker`, and every use is audited.

**Public output**
- Every public response, page payload, webhook, export and projection goes through an explicit allowlist serializer (Zod output schema).
- **Never return ORM rows.** The legacy app leaked organiser bank/tax data this way.

**Commands**
- Every write goes through `defineCommand` → `executeCommand`, which runs these steps in order:
  1. Validate
  2. Check entitlement
  3. Authorize
  4. Check step-up auth
  5. Idempotency check
  6. Tenant transaction
  7. Handler
  8. Outbox emit
  9. Audit
  10. Serialize
- `proxy.ts` is optimistic only.

**Modules**
- One package per bounded context. Import only another module's `exports` (never its `./schema`), and never touch another module's schema.
- Synchronous calls go down the tiers only; everything else uses versioned domain events via the outbox.

**Money**
- Integer minor units.
- `Idempotency-Key` on every side effect.
- Provider webhooks are verified on the raw body and deduplicated by provider event ID.
- **Hybrid funds flow** (roadmap §5.3): `organizer_mor` = direct charge on the connected account + application fee; `platform_mor` = platform charge + separate charges & transfers, with transfer at release. `reverse_transfer` does not apply to separate charges & transfers; use explicit transfer reversals.

**Time**
- Store `timestamptz`.
- Event times render in the event's IANA timezone. Reports use the org timezone. Quiet hours use the recipient's timezone.

**API**
- `/v1` changes are additive only (oasdiff gate).
- The legacy `/api/v2` facade is **frozen**. Change it only with an updated golden HAR plus owner approval. The current mobile apps depend on it, and mobile apps are **not built in this build** (roadmap §8.3).

**UI**
- Design tokens only. Every string goes through next-intl (13 locales, Arabic RTL). Use logical CSS.
- Every canvas or drag interaction needs an accessible alternative. Minimum target size is 24 px.

## Safety
- **No secrets in the repo.** Use `.env.example` names only; real values live in Doppler or cloud-environment credentials.
- **No production credentials, production data or production writes.** Development uses masked snapshots only. Production actions go through reviewed runbook scripts that the owner runs or approves step by step.
- The legacy code (`legacy/` locally, `heywebbuddy/yayatoh-legacy` on GitHub) is **reference only**. Eventmie Pro is commercially licensed: read it to write specs and test vectors, never copy its code, templates or assets.
- Migrations: expand/contract only, `lock_timeout`, concurrent indexes. The owner approves destructive steps.
- Never weaken or skip a test or CI gate to get green.

## Workflow per increment
1. Read the milestone spec (`docs/specs/<milestone>/…`) and the relevant ADRs.
2. Write failing tests from the acceptance criteria.
3. Implement. Run the full local gate, which becomes `pnpm verify` after M0.5.
4. Open a PR with: a plain-English summary, any migration summary, an acceptance checklist, the preview URL and a demo script.
5. PRs tagged `db-migration`, `auth`, `payments`, `tenancy`, `infra`, `mobile-contract` or `legal-copy` need owner approval.

**Stop and ask the owner** when:
- the spec is ambiguous
- a decision in `docs/decisions.md` is open
- a migration is destructive
- a legacy contract diff appears
- a cost would exceed the budget in roadmap §3.6
