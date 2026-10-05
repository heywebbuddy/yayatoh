# Deploy

**Who:** anyone with merge rights; production promotion by the owner. **Duration:** 15 min.

## Before
1. The PR is green: `pnpm verify`, the full e2e suite, `contracts:check`, oasdiff; risk-tagged PRs
   (`db-migration`, `auth`, `payments`, `tenancy`, `infra`) carry the owner's approval.
2. Migrations are expand-only (roadmap §9): new columns nullable or defaulted, `NOT VALID` then
   `VALIDATE` for constraints on existing tables, concurrent indexes. A contract step waits for the
   next release.
3. No deploy during an event-day freeze (the owner's calendar) unless it fixes a SEV1/SEV2.
4. Check the error budget (docs/ops/slos.md). A burned budget freezes feature deploys.

## Steps
1. Merge to `main` → Vercel builds a preview → staging (**staging**).
2. On staging: `pnpm db:migrate` runs as `migrator` (CI job) against the staging branch. Smoke:
   sign in, create a test order with the fake provider, scan it, open Activity (Verified).
3. Run `bash zap/run-baseline.sh https://<staging>` and the k6 smoke profile
   (`k6 run -e BASE_URL=https://<staging> -e PEAK_VUS=5 k6/checkout.js`) for releases that touch
   checkout, scanning, auth or headers.
4. **(production, owner)** Run migrations on production (`migrator`, direct connection,
   `lock_timeout` set in each migration) — before promoting the app when migrations are expand-only.
5. **(production, owner)** Promote the deployment in Vercel. The worker (Fly) deploys with
   `fly deploy`; it drains pg-boss jobs on SIGTERM (20 s).
6. Watch for 30 min: 5xx rate, checkout success, scan latency, CSP report volume
   (`/api/csp-report` log lines), rate-limit 429 volume, worker queue depth.

## After
- Tag the release; note migrations in the release notes.
- If any SLO alert fires within 30 min → [rollback.md](rollback.md).
