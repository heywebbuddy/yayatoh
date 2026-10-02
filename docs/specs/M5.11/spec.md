# Spec: M5.11 — Enterprise readiness

- **Milestone:** M5.11 (roadmap Phase 5, "M5.11 Enterprise readiness (S)"; Phase 5 plan `docs/plans/phase-5.md`, Wave 1, decision **P5-6**)
- **Status:** M5.11a built (2026-09-29). Everything else in M5.11 is the owner's (P5-6).
- **Risk tags:** `infra` (a new scheduled workflow; owner approval). No migration, no tenant tables, no `/v1` change, no UI.
- **Related:** D11 (retention), D26 (SOC 2 timing: Vanta, Type I 6–9 months after launch), ADR 0010 (auth and authz), ADR 0014 (allowlists), ADR 0016 (accessibility gates), M1.14 (runbooks, threat model, audit hash chain, access log)

## M5.11a — Evidence automation (done)

### 1. Goal and users
The owner runs Vanta, the auditor, the pen test, the VPAT sign-off and the DPF filing (P5-6).
M5.11a makes sure the audit window never waits on engineering: the repository maps each SOC 2
criterion to its evidence, and a scheduled workflow builds a dated, checksummed evidence bundle
the owner downloads and uploads to Vanta. Users: the owner, the auditor, Vanta.

### 2. What was built
**Control mapping** — `compliance/controls.yaml`
- All 38 in-scope Trust Services Criteria: CC1.1–CC9.2, A1.1–A1.3, C1.1–C1.2, each with evidence
  of typed kinds: `policy`, `adr`, `runbook`, `doc`, `test`, `code`, `ci_job` (workflow + job id)
  and `export` (a file the bundle collects), plus `owner` items only the owner can supply.
- `node tools/compliance/cli.ts check-controls` fails when a criterion is missing or duplicated,
  has no evidence, points at a path that does not exist, escapes the repo or sits in the wrong
  place for its kind, names a CI job the workflow does not define, or an unknown export.

**Scheduled evidence exports** — `.github/workflows/evidence.yml` (Mondays 06:17 UTC and `workflow_dispatch` with an audit window in days)
- Read-only token (`contents`, `actions`, `pull-requests`: read).
- Seeds a throwaway Postgres (per-run random role passwords, as the e2e job does), then
  `cli.ts ci` runs: control check → GitHub exports → audit samples → bundle → leak scan.
- GitHub exports (`tools/compliance/src/github.ts`): CI runs on `main` in the window with each
  run's job results for the latest 20 (the gates); branch protection and branch rules; merged
  PRs with labels, the risk tags needing owner approval (the PR template's list), reviews, the
  reviewers whose latest verdict is APPROVED (never the author), and a `no_independent_approval`
  finding; repository settings, collaborators, teams and environments. Anything a read-only
  token can't read is recorded as `available: false` with its status and a pointer to the runbook.
- Audit-log samples (`apps/worker/src/evidence.ts`, `pnpm --filter @yayatoh/worker audit-sample`):
  one audited `platform_reader` lookup (slug → id, recorded in `platform.access_log` as
  `system:evidence`) for the seed orgs only, then each org's log through the existing
  `platform.auditLog` query under that org's RLS: the allowlisted entries and the hash-chain check
  an owner sees in Settings → Activity. The CLI refuses any database host but localhost/CI.
- The VPAT draft reads the latest successful `main` CI run's e2e shard artifacts.

**Bundle** (`tools/compliance/src/bundle.ts`) — `evidence-YYYY-MM-DD/`: `controls/` (map + check),
`policies/`, `github/` (4 files), `audit/audit-samples.json`, `vpat/` (JSON + Markdown),
`README.md`, `manifest.json` (every file's sha256 and size, run metadata, control and VPAT
counts) and `SHA256SUMS` (`sha256sum -c` works). Audit samples are validated first (schema,
`seeded-ci-database` source, seed orgs only), so a bad sample leaves no partial bundle.

**Redaction and leak gate** (`tools/compliance/src/redact.ts`)
- Collectors redact every string (keys included) to `[redacted:<kind>]` before writing.
- `scan` re-reads every file: emails other than `*.test`, GitHub/Stripe/AWS/Slack/Doppler tokens,
  private keys, JWTs, bearer tokens, database URLs with passwords, `SECRET=`-style assignments,
  IPv4 (not loopback) and IPv6 addresses, Luhn-valid card numbers, and any binary file. Findings
  show a masked preview only. Any finding fails the job.
- The workflow then proves the gate: canaries (`src/canaries.ts`, assembled at run time with
  random bodies so the repo's own gitleaks scan stays clean) are planted in copies of the bundle;
  our scan must fail on secret and on customer-data canaries, and gitleaks (v8.28.0, checksum
  pinned) must fail on the secret ones. Then gitleaks scans the real bundle, then upload
  (`evidence-<run id>`, 90 days).

**VPAT (WCAG 2.2 AA) draft** (`tools/compliance/src/vpat.ts`, `compliance/vpat/wcag22.yaml`)
- `expectAccessible` (apps/web/e2e/helpers.ts) now attaches an `axe-summary` to the test (rule ids,
  WCAG tags, impact and node counts only; no selectors, URLs or page text); CI adds a JSON reporter
  (`apps/web/e2e-results/results.json`, uploaded with the shard reports). No new e2e tests.
- All 55 WCAG 2.2 A/AA criteria; axe rules map to criteria through axe's own `wcagNNN` tags;
  keyboard-only, Arabic RTL, drag, error, status, sign-in and 375 px suites map by test title or
  project. Status per VPAT 2.5: Supports / Partially Supports (a serious or critical axe violation
  or a failing mapped test, named) / Not Applicable (with the reason; owner confirms) / Not
  Evaluated (manual review needed, with what to check). Criteria where automation is partial are
  marked for manual confirmation even when they pass. Marked "DRAFT — pending owner sign-off".

**Policy drafts** (`compliance/policies/`, each "draft, pending owner" with an unsigned approval
row): information security, access control, change management, incident response, vendor
management (with the vendor inventory), data retention (D11 periods) and business continuity
(RPO/RTO), linked to the runbooks.

**Owner side**: `docs/runbooks/evidence-production.md` (download and verify the bundle; admin-only
GitHub exports; the quarterly access review per system; production audit samples with the reviewed
sampler in `--production` mode, which needs `EVIDENCE_PRODUCTION_READ=owner-approved` and an
explicit org list and is stamped `production-owner-run` so the CI bundle refuses it), and
`docs/owner-inbox.md` → "Enterprise readiness (M5.11, P5-6)".

### 3. `touches:`
```yaml
touches:
  - compliance/**
  - tools/compliance/**
  - apps/worker/src/evidence.ts
  - apps/worker/scripts/audit-sample.ts
  - apps/worker/tests/evidence*.ts
  - apps/worker/package.json           # audit-sample script
  - apps/web/e2e/helpers.ts            # axe-summary attachment
  - apps/web/playwright.config.ts      # CI JSON reporter
  - .github/workflows/evidence.yml
  - .github/workflows/ci.yml           # upload e2e-results with the shard report
  - .gitignore
  - docs/runbooks/evidence-production.md
  - docs/runbooks/README.md
  - docs/owner-inbox.md
  - docs/specs/M5.11/spec.md
```

### 4. Data model, API, events
None. No migration, no tenant table, no `/v1` or `/api/v2` change, no new events.

### 5. Acceptance criteria
| ID | Criterion | Test |
|---|---|---|
| AC-M5.11a-01 | Every in-scope criterion (CC1–CC9, A1, C1) has at least one evidence source and every referenced path, CI job and export resolves | `tools/compliance/tests/controls.test.ts` (unit) |
| AC-M5.11a-02 | The mapping check rejects a missing criterion, empty evidence, missing/escaping/misplaced paths, unknown jobs, workflows and exports, duplicates | `tools/compliance/tests/controls.test.ts` |
| AC-M5.11a-03 | **The evidence bundle builds from a CI run with no manual step** (same `cli.ts ci` the workflow runs; exports, samples, VPAT, policies, checksums verify) | `tools/compliance/tests/evidence.int.test.ts` (integration) |
| AC-M5.11a-04 | **No secrets or customer data in the bundle** (leak scan clean; no DB passwords, app secrets, tokens, fixture buyers, API keys or non-seeded orgs) | `tools/compliance/tests/evidence.int.test.ts` |
| AC-M5.11a-05 | Planted secret canaries fail the leak gate | `tools/compliance/tests/evidence.int.test.ts`, `redact.test.ts`; workflow self-test step (with gitleaks) |
| AC-M5.11a-06 | Planted customer-data canaries (email, IP, card) fail the leak gate | `tools/compliance/tests/evidence.int.test.ts`, `redact.test.ts` |
| AC-M5.11a-07 | Audit-log samples come only from seeded orgs, via an audited `platform_reader` lookup and the existing allowlisted Activity query; a non-seeded or production sample is refused with no partial bundle | `tools/compliance/tests/evidence.int.test.ts`, `apps/worker/tests/evidence.int.test.ts` |
| AC-M5.11a-08 | The sampler refuses non-local databases; production mode needs the owner confirmation and an explicit org list | `apps/worker/tests/evidence.test.ts` (unit) |
| AC-M5.11a-09 | Redaction rules: `.test` emails only; tokens, keys, IPs, cards found; hashes, UUIDs, versions and times not; previews never echo the value; deep redaction includes keys | `tools/compliance/tests/redact.test.ts` |
| AC-M5.11a-10 | GitHub exports: pagination, read-only 403/404 recorded as unavailable, branch protection fields, merged PRs in the window, risk labels = the PR template's tags, latest-verdict approvals excluding the author, redacted titles, 5xx fails | `tools/compliance/tests/github.test.ts` (unit) |
| AC-M5.11a-11 | VPAT draft from a fixture axe report: Supports, Partially Supports (axe violation, failing keyboard test), Not Applicable, Not Evaluated, advisories; 55 criteria; marked draft | `tools/compliance/tests/vpat.test.ts` (unit, `fixtures/playwright-report.json`) |
| AC-M5.11a-12 | Seven policy drafts, each "draft, pending owner", links resolve, D11 periods stated; seed-org allowlists agree; the workflow is scheduled + dispatchable, read-only, and gates before upload | `tools/compliance/tests/consistency.test.ts` (unit) |
| AC-M5.11a-13 | Dry run of the scheduled workflow via `workflow_dispatch` | Documented below (owner or merge session runs it after merge: a workflow runs only from the default branch) |

### 6. Dry run (`workflow_dispatch`)
GitHub only offers **Run workflow** for workflows on the default branch, so the first real run
happens after merge: Actions → Evidence → Run workflow (audit window 90). Expected: the control
check prints `38 criteria, … evidence sources, all resolve`; the self-test prints
`ok: leak gate rejects secret canaries`, `… customer canaries` and `ok: gitleaks rejects secret
canaries`; gitleaks reports no leaks on the bundle; artifact `evidence-<run id>` holds the files
listed in §2. Locally the same pipeline ran against the seeded dev database with
`node tools/compliance/cli.ts ci --out /tmp/ev --skip-github` (3 seed orgs, bundle clean,
`sha256sum -c SHA256SUMS` all OK, gitleaks 8.28.0 clean, canaries rejected by both scanners), and
the integration test runs `ci` end to end with a fake GitHub API.

### 7. Later / not yet
- **Owner (P5-6):** Vanta contract and upload, auditor, pen test after Waves 1–3, VPAT sign-off
  after manual NVDA/VoiceOver/zoom reviews, DPF self-certification, policy approval, quarterly
  access reviews (owner inbox).
- Collaborators and classic branch protection need an admin token; the read-only workflow records
  them as unavailable and the owner exports them (runbook step 2). A fine-grained admin-read token
  as a repository secret would let the workflow export them; pending owner.
- Vanta API upload (needs the Vanta account; would sit behind a port with a fake).
- Evidence from hosting providers (Vercel, Neon, Fly, AWS) by API: owner accounts first.
- The VPAT draft reads only the latest green `main` run; a trend across runs is later.
- Pending owner: the weekly schedule (Mondays 06:17 UTC), the 90-day audit window and 90-day
  artifact retention; the "no independent approval" finding when build sessions open PRs under the
  owner's account (owner inbox).
