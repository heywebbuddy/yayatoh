# e2e result: batch 3w, shard 3/3

- SHA: 1000091efefb844cc64003f56bf6ffefdad5d868
- Command: `cd apps/web && npx playwright test --shard=3/3 --reporter=line` (3 projects, 2 workers, headless shell), fresh Postgres 18 (pgvector), Redis, Mailpit and Gotenberg, Node 24.21.0
- Counts: 1101 tests: **1094 passed, 7 failed, 0 skipped, 0 flaky** (2.2 h)
- After solo reruns (desktop-1280 only, each once): 6 of the 7 pass alone; 1 still fails (form-controls snapshot).
- Note: an earlier first run (a session restart killed it at 1090/1101) had no Gotenberg and showed many PDF failures. It is discarded; this result is the complete rerun with Gotenberg.

## Failures (all in the desktop-1280 project)

| # | Test | Exact error | Solo rerun |
|---|---|---|---|
| 1 | e2e/account-privacy.spec.ts:176 "delete my account › the only owner of an organization sees why they can't delete (no form); a co-owner's stale form is refused with the organization named" | `expect(locator).toBeVisible() failed` on `getByRole('dialog', { name: 'Confirm it\'s you' }).or(getByRole('heading', { name: 'Your account was deleted', level: 1 }))`, timeout 5000ms, element(s) not found (account-privacy.spec.ts:235, in deleteFromPage) | passed |
| 2 | e2e/account-privacy.spec.ts:108 "delete my account › validation, step-up, deletion, the confirmation email; ..." | `Timeout 5000ms exceeded while waiting on the predicate` at account-privacy.spec.ts:151, `.toContain('Your Yayatoh account was deleted')` (Mailpit subjects) | passed |
| 3 | e2e/coupons-currency.spec.ts:202 "event currency › an event is created in another currency, prices in it, and changes until its first order" | `Test timeout of 30000ms exceeded.` | passed |
| 4 | e2e/form-controls.spec.ts:51 "the chevron sits inside the field › visual snapshot: the three sizes in LTR and RTL" | `expect(locator).toHaveScreenshot(expected) failed`, locator `#size-sm-light` `../../..`: `Expected an image 1168px by 82px, received 1168px by 83px.` (snapshot select-sizes-light.png) | **failed again** with `expect(locator).toHaveScreenshot(expected) failed` |
| 5 | e2e/p6-journeys-a.spec.ts:148 "Phase 6 journeys A › API: key with step-up revoke, /api/v1 use, rate limit, 401 after" | `expect(received).toBeGreaterThan(expected)` Expected: > 0, Received: 0 at p6-journeys-a.spec.ts:217 (`limited`) | passed |
| 6 | e2e/reports.spec.ts:96 "reports and dashboard (M1.12) › every number on the dashboard and report matches the orders made through the UI" | `expect(locator).toBeVisible() failed`, locator `[id="booking-filter-list"]` resolved to `<div hidden="" role="listbox" id="booking-filter-list">`, received hidden, 5000ms (helpers.ts:299 pickOption, called from reports.spec.ts:273) | passed |
| 7 | e2e/webhooks.spec.ts:37 "webhooks console (M6.3b) › add an endpoint, send a test, see the signed delivery, then delete it" | `Test timeout of 30000ms exceeded.` and `expect(locator).toBeVisible() failed` on `getByRole('status').filter({ hasText: 'Test message sent (order.paid)' })` (webhooks.spec.ts:62), `Protocol error (Runtime.callFunctionOn): Internal server error, session closed.` | passed |

No product or test code was changed.
