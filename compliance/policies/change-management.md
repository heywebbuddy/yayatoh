# Change management policy

**Status: draft, pending owner.** SOC 2: CC8.1, CC3.4, CC5.3.

## Rules
1. Every change reaches `main` through a pull request; nobody pushes to `main` directly (branch
   protection; exported weekly in `github/branch-protection.json`).
2. Every PR passes the CI gates: lint, module boundaries, typecheck, unit, integration and
   isolation on real Postgres, e2e with axe at three widths in English and Arabic, OpenAPI
   additive-only (oasdiff), gitleaks, and the gate self-test canaries.
3. Every PR uses the template: summary, milestone and spec, risk tags, migration summary,
   acceptance checklist, demo script.
4. PRs tagged `db-migration`, `auth`, `payments`, `tenancy`, `infra`, `mobile-contract` or
   `legal-copy` need the owner's approval before merge. The weekly export lists each merged PR,
   its labels, its reviewers and approvals, and flags any merged without an independent approval.
5. Migrations are expand/contract with `lock_timeout` and concurrent indexes; destructive steps
   need the owner's approval.
6. The legacy `/api/v2` facade is frozen; `/v1` changes are additive only.
7. Production deploys follow [deploy.md](../../docs/runbooks/deploy.md); a bad deploy is rolled
   back per [rollback.md](../../docs/runbooks/rollback.md).
8. Emergency changes may be merged by the owner during a SEV1 and get a retrospective review
   within 72 h ([incident.md](../../docs/runbooks/incident.md)).

## Evidence
`github/pull-requests.json`, `github/ci-runs.json` and `github/branch-protection.json` in the
weekly evidence bundle (`.github/workflows/evidence.yml`).

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
