# Load tests (k6) — M1.14d

Two scripts with thresholds from roadmap §10 (performance budgets and SLOs):

| Script | What | Thresholds |
|---|---|---|
| `checkout.js` | Public event page, then a checkout start through the real no-JS form post (the same Server Action the page runs) for a free ticket | event page p95 < 400 ms · checkout p95 < 800 ms · errors < 1 % · checks > 99 % |
| `scan.js` | Door devices verifying tickets online (`POST /api/v1/scans/batch`) plus manifest paging | scan p95 < 300 ms · manifest p95 < 1 s · errors < 1 % |

Every iteration is a new visitor (fresh device cookie, its own TEST-NET client IP), so the rate
limiter sees realistic traffic; the shared-IP case is tested separately (e2e).

## Run locally
```sh
pnpm --filter @yayatoh/web load:prepare          # load-test event, free ticket type, 2 000 tickets, a device token → k6/.data/load.json
pnpm --filter @yayatoh/web build && (cd apps/web && npx next start -p 3000) &
k6 run -e BASE_URL=http://localhost:3000 k6/checkout.js
k6 run -e BASE_URL=http://localhost:3000 k6/scan.js
```
Knobs: `PEAK_VUS`, `RAMP`, `HOLD`, `THINK` (seconds between page view and checkout; `0` = stress)
for checkout; `SCANS_PER_SECOND`, `DURATION` for scan. Staging runs (3× expected peak, roadmap
§7.6) use the same scripts with `BASE_URL` and a `LOAD_DATA` file prepared on staging.

Latest results: docs/ops/security-testing.md.
