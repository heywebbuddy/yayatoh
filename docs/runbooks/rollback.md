# Rollback

**Trigger:** a deploy made errors, latency or correctness worse; any cross-tenant exposure is a
SEV1 ([incident.md](incident.md)) first.

## App (minutes)
1. **(production, owner)** Vercel → Deployments → the previous production deployment → *Promote*.
   Instant; no rebuild. The worker: `fly releases` → `fly deploy --image <previous>`.
2. Confirm: error rate back to baseline, checkout and scan smoke tests pass.

## Database
Migrations are expand-only, so the previous app runs on the new schema: **do not roll back
migrations**. If a migration itself is wrong:
1. Stop further deploys. Write a forward fix migration (reviewed PR, `db-migration` label).
2. Data damage → [restore-drill.md](restore-drill.md) "Real restore" (point-in-time branch, then
   copy the affected rows back with a reviewed script; never restore over live data wholesale).

## Feature kill switches (no deploy)
Staff console → Suspensions: pause checkout, publishing or messaging for an org; staff can hold an org's payouts.

## After
Post-incident review if customers noticed (incident.md). Add a test that would have caught it.
