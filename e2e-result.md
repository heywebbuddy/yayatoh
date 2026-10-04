# e2e result: batch 3m, shard 2/3

- SHA: 92621e32573247b79b21c975ec881ca97b95ec66
- Command: `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (3 projects, 2 workers, headless shell), fresh DB, web and admin built, Node 24.21.0, pnpm 12.6.0
- Services: Postgres (pgvector/pgvector:pg18), Redis, Mailpit (pulled via mirror.gcr.io), Gotenberg
- Duration: 2.0h
- Counts: 1085 tests: **1048 passed, 6 failed, 31 skipped, 0 flaky** (as reported by Playwright, no retries)
- Solo rerun: all 6 failures **passed** when rerun alone (`--project=tablet-768 --workers=1`).

## Failures (all `[tablet-768]`)

| # | Test | Error in full run | Solo rerun |
|---|------|-------------------|------------|
| 1 | e2e/checkin.spec.ts:22 check-in › door staff admit a ticket once, see the duplicate, undo, and reject a bad code | `Test timeout of 30000ms exceeded.` | passed (42.0s) |
| 2 | e2e/dates.spec.ts:326 multi-date events › the scanner admits a ticket on its own date and rejects it on another | `Test timeout of 30000ms exceeded.` | passed (40.2s) |
| 3 | e2e/distribution.spec.ts:21 ticket distribution › an organizer sends a ticket; the guest claims it; the old QR is rejected; the holder passes it on | `Test timeout of 30000ms exceeded.` | passed (44.1s) |
| 4 | e2e/leads.spec.ts:227 lead retrieval (M5.6b) › offline: scans queue on the device and sync exactly once when the network is back | `Error: expect(locator).toHaveText(expected) failed` Locator: `getByTestId('leads-network')`, Expected pattern `/^Offline/`, Received `"Online"`, Timeout 5000ms | passed (1.0m) |
| 5 | e2e/series-templates.spec.ts:129 duplicate and templates › duplicating an event copies its setup but never its orders | `Test timeout of 30000ms exceeded.` / `Error: page.evaluate: Test timeout of 30000ms exceeded.` at helpers.ts:152 (`.analyze()` in expectAccessible) | passed (37.0s) |
| 6 | e2e/webhooks.spec.ts:81 webhooks console (M6.3b) › a real outbox event reaches an endpoint subscribed to it (thin, from the relay) | `Test timeout of 30000ms exceeded.` | passed (32.0s) |

All six failures are in the tablet-768 project. Solo reruns that passed took 32–60s, so the 30s timeout failures are consistent with load from the parallel projects.
