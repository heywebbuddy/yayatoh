# M7.X — Load tests (k6) for the Phase 7 `/v1` routes

- **Status:** scripts built and run locally on 2026-10-15 (k6 v1.4.2). Three of the four meet their thresholds on this VM. **`scan-batch-peak.js` does not**, and the reason is in the server, not the script (section 5). Staging is the real gate and needs the owner (section 7).
- **Server changes:** none. (The heartbeat is not rate limited at 500 devices, so the limiter was left alone; section 4.)
- **Files:** `k6/me-tickets.js`, `k6/app-checkout.js`, `k6/scan-batch-peak.js`, `k6/staff-heartbeat.js`, helpers added to `k6/lib.js`, `apps/web/scripts/load-prepare.ts` (the `load:prepare` script), `k6/README.md`, `docs/ops/security-testing.md` (k6 section), `docs/ops/slos.md` and `docs/runbooks/deploy.md` (one line each).

## 1. What was built
| Script | Models | Routes |
|---|---|---|
| `me-tickets.js` | The attendee app at doors-open: launch (tickets and orders lists, together), a tap on a ticket after `THINK` seconds (the QR code must show), a tap on the order. | `GET /v1/me/tickets`, `/me/tickets/{id}`, `/me/orders`, `/me/orders/{id}` |
| `app-checkout.js` | Signed-in attendees starting a checkout for the load event's free pass with the fake provider (`action: paid`), one `Idempotency-Key` per iteration and a replay of the same request that must return the same order. A second scenario, the limit probe, shows the `checkoutStart` policy does trigger. | `POST /v1/public/events/{slug}/checkout` |
| `scan-batch-peak.js` | Staff devices syncing at 3× the `scan.js` peak. `MODEL=open` (default): a fixed request rate of small live batches (1–3 scans) and 500-scan offline outbox syncs, each replayed to prove idempotency. `MODEL=closed`: 30 door phones with one flush in flight each, an outbox that grows while the server is slow, and the app's backoff (section 5.2). Payload copied from `apps/staff/src/scan/api.ts` and the route's schema. | `POST /v1/scans/batch` (device token `yyd_…`) |
| `staff-heartbeat.js` | 500 devices, a heartbeat each every 30 s (payload of `apps/staff/src/device/session.ts`), plus 25 devices reading the device board every 15 s. | `POST /v1/devices/heartbeat`, `GET /v1/staff/events/{eventId}/overview` |

Every request carries the `X-Yayatoh-Client` header the apps send (so the version gate and the telemetry run as in production) and its own client IP. Every script stops at once, with a message that says what to do, when the prepared data is missing or from before M7.x, when the prepared accounts or devices are refused by the target, or when the requested rate would use up the prepared data, the `checkoutStart` budget or the risk-rule allowance (verified).

**`load:prepare`** now also writes (into `k6/.data/load.json`, ignored by git):
- `LOAD_ATTENDEES` (default 200) accounts `load-attendee-<i>@example.test` with a verified email, an order of two tickets for the load event and a bearer access token. Access tokens last 15 minutes: the scripts use the written ones while enough life is left and otherwise sign in again with `attendeePassword` (`POST /v1/auth/token`, grant `password`; `SIGNIN_PACE` spaces the calls when every request comes from one address).
- `LOAD_DEVICES` (default 500) enrolled Staff devices with a token each. Devices of a previous run (label `k6 …`) are revoked first, so the load event's board lists only the current ones.
- `LOAD_TICKETS` (default 2 000) scannable tickets, as before. A 60 s `scan-batch-peak.js` run at 3× scans about 5 400: prepare with `LOAD_TICKETS=6000` or more.

The `load:prepare` package script was broken at HEAD (`server-only` refused to load outside Next); it now runs `node --conditions=react-server`, like `seed`. The edits outside the owned paths are this one line of `apps/web/package.json` and one line each in `docs/ops/slos.md` and `docs/runbooks/deploy.md`.

## 2. How to run
```sh
pnpm --filter @yayatoh/web load:prepare            # LOAD_TICKETS=6000 for scan-batch-peak.js
pnpm --filter @yayatoh/web build && (cd apps/web && npx next start -p 3000) &
k6 run -e BASE_URL=http://localhost:3000 k6/me-tickets.js
k6 run -e BASE_URL=http://localhost:3000 k6/app-checkout.js
k6 run -e BASE_URL=http://localhost:3000 k6/scan-batch-peak.js               # open model, 3×
k6 run -e BASE_URL=http://localhost:3000 -e MODEL=closed k6/scan-batch-peak.js  # the Staff app's closed loop
k6 run -e BASE_URL=http://localhost:3000 k6/staff-heartbeat.js
```
Knobs, in the style of the other scripts (`BASE_URL`, `LOAD_DATA`, `DURATION`, `PEAK_*`): see `k6/README.md`. Run one script at a time. Re-prepare between runs of `scan-batch-peak.js` (it admits the codes it uses; `CODE_OFFSET` skips used ones) and wait 10 minutes between runs of `app-checkout.js` (the limiter keeps its counters that long) or prepare more accounts.

## 3. Peak models (all tunable)
| Script | Default peak | Why |
|---|---|---|
| `me-tickets` | `PEAK_LAUNCHES=10` openings a second (4 requests each, ~40 a second) | Roadmap §10 sizes the door at 20 scans a second for a whole event (fixture `load-20k`: 20 000 tickets). Everyone at the door shows a ticket and about half do it in the app. Staging at 3× passes `PEAK_LAUNCHES=30`. 200 accounts round robin: one account is hit every 20 s, never a hot row. |
| `app-checkout` | `PEAK_CHECKOUTS=3` starts a second | The web test (`checkout.js`, M1.14d) runs about 10 starts a second at its realistic pace; the app is the secondary channel, a third of it. Staging at 3×: `PEAK_CHECKOUTS=9`, with `LOAD_ATTENDEES=500` (see the limits below). |
| `scan-batch-peak` | `SCANS_PER_SECOND=30` (`scan.js`'s target) × `MULTIPLIER=3` = 90 scans a second on 30 devices; 70 % in small live batches (1, 2, 3 scans in turn, ~32 requests a second), 30 % (`OFFLINE_SHARE`) in 500-scan outbox syncs (one every ~18 s) | The brief fixes the peak as the existing scan target. The Staff app flushes after each scan and runs one flush at a time (`scheduler.ts`), so live batches are small; a device that was offline uploads up to `BATCH_SIZE = 500` at once. |
| `staff-heartbeat` | 500 devices, one beat each per 30 s (16.7 a second); 25 board readers every 15 s | The brief's largest event; `HEARTBEAT_MS = 30 000` and `REFRESH_MS.overview = 15 000` in the Staff app (the board is read only while the staff screen is open, so 5 % of devices). |

Two limits that shape `app-checkout.js` (both are the server's rules, not the script's):
- **`checkoutStart` policy** (`packages/platform/src/security/rate-limit.ts`): 20 starts per 10 minutes per signed-in person, replays included (the limiter runs before the replay is recognised), plus a 600 per 10 minutes IP ceiling. Below it there must be no 429 (`checkout_rate_limited` = 0). The limit probe sends starts for an event that does not exist (the limiter counts a start before the event is looked up: 404 means "let through", no order is made) and must be stopped by a well-formed 429 at ≤ 20 starts.
- **Risk rules** (M1.6e, `packages/modules/payments/src/risk.ts`): the 10th order of one email address within an hour is `403 risk_blocked` and the 4th is flagged for review. The script allows 8 orders per attendee per run (the prepared order counts) and refuses to start above that. A staging run at 3× over 200 accounts would be refused for this: prepare 500.

## 4. Thresholds and where each comes from
| Script | Threshold | Source |
|---|---|---|
| `me-tickets` | tickets list p95 < 400 ms, orders list p95 < 400 ms | M7.x brief (lists). Roadmap §10: API reads ≤ 200 ms p95 on a quiet system. |
| | ticket detail (QR) p95 < 300 ms | M7.x brief ("QR must show fast at the door"). |
| | order detail p95 < 400 ms | Our choice: a list-class read (lines, refund terms, tickets held). The brief fixed only lists and ticket detail. |
| | errors < 1 %, checks > 99 % | As the other scripts. |
| `app-checkout` | start p95 < 800 ms (and the replay) | Roadmap §10: checkout hold → payment ≤ 800 ms p95 (the web budget). |
| | `checkout_rate_limited` = 0 below the budget; probe: ≥ 1 well-formed 429 (problem+json `rate_limited`, `Retry-After`), ≤ 20 starts | M7.2f spec (the web's `checkoutStart` policy applies). |
| | every `Idempotency-Key` replay returns the same order | M7.2f spec (idempotency). |
| `scan-batch-peak` | **small live batches p95 < 300 ms** | **Roadmap §10, scan verify online p95 < 300 ms.** A small batch is one verify's worth of work. |
| | **500-scan batches p95 < 1.5 s** | **Not a roadmap number: this project's budget, set by the M7.x brief** (3 ms a scan). The roadmap and plan fix only the 300 ms verify path. It has to be small enough that a door device finishes a sync well inside the 30 s heartbeat interval. |
| | `replay_idempotent` = 100 %: a replayed batch answers `stored: false` for every scan, `duplicatesOffline: 0`, the very same verdicts | ADR 0011 (idempotent by `scanId`); the second post creates no new admission. |
| | `MODEL=closed`: small batches (≤ 3 scans) p95 < 300 ms; batches of ≥ 100 scans p95 < 1.5 s; **age of the oldest unsynced scan when a batch is sent (`outbox_oldest_age_ms`) p95 < 5 s** | Latency bars as above. The 5 s is **our proposal, not a roadmap number**: Command Center tiles are ≤ 3 s p95 from the moment the data is on the server (§10), so a scan should wait on the phone not much longer than that; 5 s is 3 s plus the network, and half of the app's own 10 s retry tick (`scheduler.ts`). |
| | `fresh_admitted` > 99 % (the first post admits every scan: the data is fresh), no 429, errors < 1 % | Script sanity; the device bucket is 3 000 a minute per token. |
| `staff-heartbeat` | heartbeat p95 < 300 ms | M7.x brief; the same bar as verify. |
| | **no 429** (`heartbeat_rate_limited` = 0) | M7.x brief. The device bucket is `{ limit: 3000, window: 60 }` per token (`packages/api-v1/src/index.ts`); a device sends 2 heartbeats and 4 board reads a minute, so none is limited and **the limiter needed no change**. |
| | board read p95 < 1 s | Our target: an aggregate (counts, 500 device rows, alerts; 112 KB). Stricter than the roadmap's 3 s for Command Center tiles. |
| | errors < 1 %, checks > 99 % | As the other scripts. |

## 5. Results (local, 2026-10-15)
**Environment, honestly:** one `next start` (Node 24, production build of this branch) and Postgres 18 (pgvector image, its own Docker container so other sessions' tests cannot change its roles) with k6 v1.4.2, all on the same 4 vCPU / 16 GB cloud VM that three other sessions were using at the same time. **This VM is not a performance environment.** The final runs below were taken while the load average was 0.5–1.6 (mostly these runs). An earlier `me-tickets` 3× run taken at a load average of 4–6, while another session was exporting an app bundle, gave p95 of about 2 s instead of 93 ms, which is how noisy this machine is. The scan results were the same in both conditions. The load event had grown to about 39 000 tickets and 30 000 scans by the end. Use these numbers for orders of magnitude and for the finding in section 5.1, not as capacity figures.

| Run | Load | Result | Thresholds |
|---|---|---|---|
| `me-tickets.js`, peak | 10 openings/s for 60 s (601 openings, 2 404 requests) | tickets list p95 **47 ms**, orders list **27 ms**, ticket **26 ms**, order **24 ms**; 0 errors; 4 808 checks, 100 % | ✓ all |
| `me-tickets.js`, 3× | 30 openings/s for 30 s (901 openings, 3 604 requests, 116 req/s) | lists p95 **93 / 73 ms**, ticket **73 ms**, order **66 ms**; 0 errors; 7 208 checks, 100 % | ✓ all |
| `app-checkout.js` | 3 starts/s for 60 s over 190 attendees (181 orders, each replayed) | start p95 **74 ms**, replay **30 ms**; 181 replays returned the same order; 0 errors; **0 429 in the main run**; probe (fresh account): **20 starts, then 8 well-formed 429** | ✓ all |
| `staff-heartbeat.js` | 500 devices, 3 min (3 000 heartbeats at 16.7/s, 300 board reads), 25 readers | heartbeat p95 **26 ms** (avg 19), board p95 **75 ms** (avg 61); **0 429**; 0 errors; 6 602 checks, 100 % | ✓ all |
| `scan-batch-peak.js`, 1×, small batches only | 30 scans/s (15 req/s) for 30 s | small p95 **53 ms**; replays idempotent 46/46; fresh admitted 901/901 | ✓ all |
| `scan-batch-peak.js`, 2×, small batches only | 60 scans/s (30 req/s) for 30 s | small p95 **185 ms** (replay 169 ms); replays idempotent 90/90; 30 iterations/s sustained | ✓ all |
| `scan-batch-peak.js`, **3×, small batches only** | 90 scans/s (45 req/s) for 30 s | small p95 **8.5 s**; only **29 of 45** requests/s completed (225 dropped); replays idempotent 113/113; fresh admitted 2 251/2 251 | ✗ p95 < 300 ms |
| `scan-batch-peak.js`, 1×, mixed | 30 scans/s, 30 % as 500-batches (2 batches in 60 s) | 500-batch p95 **3.35 s** (avg 3.15 s), its replay **1.05 s**; **small p95 1.9 s** while a batch runs (median 39 ms); replays idempotent 64/64 | ✗ both |
| `scan-batch-peak.js`, **3×, mixed (the brief's run)** | 90 scans/s, 30 % as 500-batches (3–4 in 60 s) | small p95 **7.7 s**; 500-batch p95 **7.5 s** (avg 5.4 s; alone, 2.8–3.7 s), its replay 5.3 s; 25.6 of 31.5 iterations/s completed; **replays idempotent 179/179; fresh admitted 5 481/5 481; 0 errors, 0 429** | ✗ all four latency thresholds |
| `scan-batch-peak.js`, 3×, outbox syncs only | 4 batches of 500 in 20 s | 500-batch p95 **2.87 s**, replay 0.36 s; replays idempotent 4/4 | ✗ p95 < 1.5 s |

What the scan runs prove and what they do not:
- **Correctness holds at 3×.** Every first post admitted every scan, every replay answered `stored: false` for every scan with the same verdicts and no offline duplicate, there were no 5xx and no 429, and the payload is accepted by the real route schema.
- **Latency does not meet the thresholds at 3× on this VM**, and not for lack of CPU: during the 3× small-batch run the VM was 65 % idle, `next-server` used 70 % of one core and Postgres little.

### 5.1 Finding for the owner: `scans/batch` is serialised per event
`syncScansCommand` takes `pg_advisory_xact_lock(hashtextextended('checkin.sync:<eventId>'))` for the whole transaction (M3.4a: "batches are short; devices simply wait their turn"). Everything that syncs scans for one event therefore runs one request at a time, and a request holds the lock for its whole duration:
- A 1-scan batch takes about 27 ms uncontended here, so one event tops out at roughly **30 batches a second**. 2× (30 req/s) is just under it (p95 185 ms); 3× (45 req/s) is over it and the queue grows without bound. The existing `scan.js` (30 single-scan requests a second, the same route) sits on that edge too: on this quiet VM it now gives scan p95 **619 ms**, where the 2026-09-27 run in `docs/ops/security-testing.md` recorded 37 ms (a different, smaller database; the cause of the difference was not isolated).
- A 500-scan batch holds the lock for about **3 s** here (6 ms a scan, roughly eight queries each), twice the 1.5 s budget on its own. **While it runs, every live scan of that event waits** for it, which is why the small-batch p95 goes to seconds in the mixed runs even at 1× peak. A door device at an event with another device's big offline sync in flight sees its verdicts stall.
- The replay of a 500-batch costs 0.3–1 s (500 lookups by `scanId`), also under the lock.

These are not script faults: the idempotency and payload checks pass. The Staff app is unaffected in correctness (a slow answer only delays the outbox flush; scans are decided on the phone), but online verification on a busy event is not met at 3× by the current design. Options, none of them done here (the check-in module is outside this increment's paths):
1. Split a large upload into chunks (for example 50 scans) each in its own transaction, so the lock is held for ≈ 0.3 s at a time and live batches interleave. The command is already idempotent by `scanId`, so a chunked upload is safe.
2. Narrow the lock to the admission insert, or key it by ticket instead of by event.
3. Fewer queries per scan (look up the prior scans and tickets of a batch at once).
4. If the budget is the problem rather than the design: measure on staging first (below), then decide; the 1.5 s budget is this project's number, not the roadmap's.

### 5.2 Closed-loop model (`MODEL=closed`), the Staff app's own behaviour
The open runs above push a fixed request rate whatever the server does. The Staff app does not: `scheduler.ts` flushes the outbox after each scan with one flush in flight per device, and `engine.ts` `runFlush` peeks again as soon as an answer arrives and sends everything queued (up to 500), oldest first; a failed flush waits `backoff.ts` (2 s, 4 s, 8 s … ±20 %). The script's second scenario is exactly that: 30 VUs, one door phone each, scans arriving per phone as a Poisson process at its share of the target (30 scans/s × the multiplier ÷ 30 phones), an outbox per phone, one POST in flight, the app's backoff on a 429/5xx. There is no offline share: big batches appear only if the server falls behind. One batch in 20 is replayed (extra to the app's traffic) to check idempotency. Run for 60 s each on the same local setup (load average 1.2–1.7), 0 errors, 0 × 429, no backoff ever taken, every first post admitted every scan and every replay was idempotent (78/78, 91/91, 60/60).

| Target | Scans admitted | Requests/s (incl. replays) | Batch size (avg / p95 / max) | ≤ 3-scan batches p95 | Oldest unsynced scan when sent, p95 (max) | … until the answer arrives, p95 (max) |
|---|---|---|---|---|---|---|
| 1× (30/s) | 1 878 (31/s) | 32 | 1.0 / 1 / 2 | **103 ms** ✓ | **5 ms** (0.3 s) | 112 ms (0.5 s) |
| 2× (60/s) | 3 650 (61/s) | 37 | 1.7 / 4 / 7 | **962 ms** ✗ | **835 ms** (1.6 s) | 1.7 s (2.5 s) |
| 3× (90/s) | 5 247 (87/s) | 25 | 3.6 / 7 / 15 | **1.48 s** ✗ | **1.51 s** (2.6 s) | 3.0 s (4.0 s) |

Reading:
1. **The closed loop self-regulates at 3×.** The phones kept up (87 of 90 scans/s admitted), requests per second fell from 37 to 25 as batches grew from 1.7 to 3.6 scans (never more than 15), and nothing collapsed, where the open model with the same scan rate queued without bound (section 5). That is the Staff app's real behaviour, and it is the better predictor for one event with 30 phones.
2. **Oldest-unsynced-scan age is inside the proposed 5 s budget at every size**: p95 1.5 s when a batch is sent at 3× (3.0 s until it is acknowledged, max 4.0 s). The scan is decided and saved on the phone first, so the door never waits for this; the age is how stale the organizer's live counts and the other doors' duplicate checks can be.
3. **The 300 ms bar for batches of ≤ 3 scans is still not met at 2× and 3×** (p95 0.96 s and 1.5 s). It is the same per-event lock as in 5.1: 30 phones with a request each in flight queue behind one lock (about 27 ms apiece), so each flush takes roughly 30 × the hold time. The app does not wait for that answer, so the cost is sync lag (point 2), not a slower door. The 300 ms SLO belongs to the online verify path; for the Staff app's batch sync the age of the oldest unsynced scan is the number that matters, and it passes.
4. **Limits of this reading:** one event, 30 phones, a Poisson arrival (no crowd bursts), no offline spells, a shared VM. A burst or a phone returning with a 500-scan outbox would take the 3 s lock hold of 5.1 and add it to everyone's age; this model does not include that. The 5.1 options (chunked uploads, a narrower lock) would help both.

## 6. Notes
- The final numbers for `me-tickets`, `app-checkout` and `staff-heartbeat` are far inside their budgets, which only says this VM at this load is fine; the 3× `me-tickets` run (116 req/s on one Node process) still passed.
- A first `app-checkout` probe against a real event hit `403 risk_blocked` before the limiter's 20, which is how the risk rule above was found; the probe uses a non-existent event for that reason.
- `load:prepare` refuses a non-local database (as before). Data for staging cannot be prepared with it as it stands.

## 7. What the staging 3× run needs from the owner
1. **A staging URL** (`BASE_URL`) with the fake payment provider (never `PAYMENTS_PROVIDER=stripe`) and the real Postgres, rate-limit store (Upstash) and hosting topology; the numbers above say nothing about those.
2. **A `LOAD_DATA` file prepared on staging.** `load:prepare` stops at a non-local `DATABASE_URL`, like the seed. The owner decides whether to allow a staging preview branch database (the seed has `SEED_ALLOW_PREVIEW`) and who runs it. Prepare with `LOAD_ATTENDEES=500` (the 3× checkout run and the risk rules), `LOAD_DEVICES=500` and `LOAD_TICKETS` of at least 20 000 (3× scans for 3 minutes).
3. **A load generator** that is not the web server: k6 on a GitHub Actions runner or any machine in the same region. Nothing of this is in CI yet (the repo has no k6 workflow); the nightly k6 smoke the roadmap lists under CI (§10, "k6 smoke test (nightly)") is the place for the heartbeat and `me-tickets` smoke profiles (`-e DURATION=30s -e PEAK_LAUNCHES=3`).
4. **A decision on section 5.1** before the run, or its acceptance as a known finding: at 3× the scan batch thresholds will fail on any single-event load for the same reason unless the lock is narrowed or uploads are chunked.
5. Run order: `me-tickets`, `app-checkout`, `staff-heartbeat`, then `scan-batch-peak`; re-prepare before `scan-batch-peak` and wait 10 minutes between `app-checkout` runs.
