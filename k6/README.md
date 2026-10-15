# Load tests (k6) — M1.14d

Nine scripts with thresholds from roadmap §10 (performance budgets and SLOs); the last four (M7.x) load the mobile apps' `/v1` routes:

| Script | What | Thresholds |
|---|---|---|
| `checkout.js` | Public event page, then a checkout start through the real no-JS form post (the same Server Action the page runs) for a free ticket | event page p95 < 400 ms · checkout p95 < 800 ms · errors < 1 % · checks > 99 % |
| `scan.js` | Door devices verifying tickets online (`POST /api/v1/scans/batch`) plus manifest paging | scan p95 < 300 ms · manifest p95 < 1 s · errors < 1 % |
| `me-tickets.js` (M7.x) | Attendee app at doors-open: tickets + orders lists, then a ticket and its order (`/v1/me/…`), 200 prepared attendees, round robin | **peak 10 openings/s** (≈ half of the roadmap's 20 scans/s door rate shows the ticket in the app; `PEAK_LAUNCHES`) · lists p95 < 400 ms · ticket (QR) p95 < 300 ms · order p95 < 400 ms · errors < 1 % · checks > 99 % |
| `app-checkout.js` (M7.x) | App checkout start for the free load pass (`POST /v1/public/events/{slug}/checkout`, Idempotency-Key, replay returns the same order) + a limiter probe | **peak 3 starts/s** (`PEAK_CHECKOUTS`) · p95 < 800 ms (web checkout budget) · errors < 1 % · **no 429 below the `checkoutStart` budget** (`checkout_rate_limited` = 0) · the probe account must be stopped by a well-formed 429 at ≤ 20 starts (`probe_rate_limited`, counted apart) |
| `scan-batch-peak.js` (M7.x) | Staff app syncing `POST /v1/scans/batch` at **3× scan.js's peak** (90 scans/s on 30 devices): small live batches (1–3 scans) and 500-scan offline outbox syncs, each replayed | **small batches p95 < 300 ms = the roadmap's online-verify SLO** · **500-scan batches p95 < 1.5 s = this project's budget (3 ms a scan), not a roadmap SLO** · errors < 1 % · every replay idempotent (`replay_idempotent` = 1: `stored:false`, no new admission, same verdicts) · no 429. **Not met at 3× on a single event today**: `scans/batch` serialises per event (docs/specs/M7.X/load.md §5.1) |
| `staff-heartbeat.js` (M7.x) | 500 Staff devices, a heartbeat each every 30 s (16.7/s) + 25 devices reading the device board every 15 s (`GET /v1/staff/events/{id}/overview`) | heartbeat p95 < 300 ms · board p95 < 1 s (our target; roadmap tiles ≤ 3 s) · errors < 1 % · **no 429** (`heartbeat_rate_limited` = 0) |
| `api-limits.js` (M6.x) | `/v1` with a live and a test API key hammered past the plan's `api_access` quotas (600 / 120 a minute per key) | 429s are well formed (problem+json, Retry-After, RateLimit-*) · admitted between 1× and 2× the budget (token bucket) · no 5xx · p95 < 300 ms |
| `sync-throughput.js` (M6.x) | Demo connector pulling 1 500 contacts through the fake IntegrationAuth port (`/api/dev/integrations/load`) | every record pulled · ≤ 1 failure (the demo seed's broken record) · p95 < 60 s per sync · > 25 records/s |
| `warehouse-ingest.js` (M6.x) | Full analytics rebuild (`/api/dev/analytics/backfill start=1`) | finishes, reads events, repeats are idempotent · p95 < 120 s |

Every iteration is a new visitor (fresh device cookie, its own TEST-NET client IP), so the rate
limiter sees realistic traffic; the shared-IP case is tested separately (e2e).

## Run locally
```sh
pnpm --filter @yayatoh/web load:prepare          # load-test event, free ticket type, 2 000 tickets, a device token → k6/.data/load.json
# M7.x also writes 200 attendee accounts (verified email, 2 tickets, bearer token) and 500 enrolled
# Staff devices; LOAD_ATTENDEES / LOAD_DEVICES / LOAD_TICKETS change the counts (a 60 s scan-batch-peak
# run at 3× scans 5 400 tickets: LOAD_TICKETS=6000)
pnpm --filter @yayatoh/web build && (cd apps/web && npx next start -p 3000) &
k6 run -e BASE_URL=http://localhost:3000 k6/checkout.js
k6 run -e BASE_URL=http://localhost:3000 k6/scan.js
# Mobile routes (M7.x)
k6 run -e BASE_URL=http://localhost:3000 k6/me-tickets.js
k6 run -e BASE_URL=http://localhost:3000 k6/app-checkout.js
k6 run -e BASE_URL=http://localhost:3000 k6/scan-batch-peak.js
k6 run -e BASE_URL=http://localhost:3000 k6/staff-heartbeat.js
```
Knobs: `PEAK_VUS`, `RAMP`, `HOLD`, `THINK` (seconds between page view and checkout; `0` = stress)
for checkout; `SCANS_PER_SECOND`, `DURATION` for scan. Staging runs (3× expected peak, roadmap
§7.6) use the same scripts with `BASE_URL` and a `LOAD_DATA` file prepared on staging.

M7.x knobs, same style (`BASE_URL`, `LOAD_DATA`, `DURATION`, `PEAK_*`):
`me-tickets.js` — `PEAK_LAUNCHES` (openings a second, default 10), `THINK`, `ATTENDEES`;
`app-checkout.js` — `PEAK_CHECKOUTS` (starts a second, default 3), `CHECKOUT_BUDGET` (20), `PROBE=0`;
`scan-batch-peak.js` — `SCANS_PER_SECOND` (the peak, 30), `MULTIPLIER` (3), `OFFLINE_SHARE` (0.3),
`OUTBOX_SIZE` (500), `SCAN_DEVICES`, `CODE_OFFSET`; `staff-heartbeat.js` — `DEVICES` (500),
`INTERVAL` (30 s), `BOARD_READERS` (25). A script stops at once with a message when the prepared
data it needs is missing (a `load.json` from before M7.x has no attendees or devices), when the
prepared devices or accounts are refused, or when the requested rate would exhaust the data or the
`checkoutStart` budget. Access tokens last 15 minutes: the scripts sign the attendees in again with
the prepared password when the written tokens would lapse (`SIGNIN_PACE` seconds apart when every
request reaches the server from one address, since sign-in is limited per IP).

Run the scan, checkout and attendee scripts one at a time and re-prepare between runs of
`scan-batch-peak.js` (it admits the codes it uses) and within 10 minutes of `app-checkout.js` (the
limiter keeps its counters that long). Details, peak models and results: docs/specs/M7.X/load.md.

Latest results: docs/ops/security-testing.md.
