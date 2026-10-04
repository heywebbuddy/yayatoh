# e2e result: batch 3v2, shard 3/3

- SHA: `66d6010e03a85d531071053efb4a73140b86903b`
- Command: `cd apps/web && npx playwright test --shard=3/3 --reporter=line` (3 projects, 2 workers, headless shell, Node 24.21.0, fresh DB, web and admin built)
- Result: **957 passed, 6 failed, 0 skipped, 0 flaky** of 963 (2.0 h). All 6 failures are on `desktop-1280`; none on mobile-375 or tablet-768.
- Solo rerun (`--project=desktop-1280`, each test alone, once): 4 passed, 2 failed again.

| # | Test | Full-run error | Solo rerun |
|---|---|---|---|
| 1 | `e2e/coupons-currency.spec.ts:44` org coupon made, redeemed at checkout, counted; one use per buyer | `Test timeout of 30000ms exceeded.` then `locator.click: Target page, context or browser has been closed` at line 105 (`getByRole('button', { name: 'Resume <code>' }).click()`) | passed (44.3 s) |
| 2 | `e2e/coupons-currency.spec.ts:202` event created in another currency, prices in it, changes until its first order | `Test timeout of 30000ms exceeded.` (no assertion error) | passed (43.0 s) |
| 3 | `e2e/guest-site.spec.ts:57` guest website host builds the site from blocks | `Test timeout of 30000ms exceeded.` / `page.waitForResponse: Test timeout of 30000ms exceeded.` at `submit` (line 47), called from line 166 | passed (53.8 s) |
| 4 | `e2e/marketplace.spec.ts:276` custom primary domain takes over: managed subdomain 308s to it | `expect(page).toHaveURL(expected) failed`. Expected `http://rosewood-1791095692291.verified.test:3100/?from=managed`, received `http://rosewood-weddings.yayatoh.events:3100/?from=managed` (timeout 5000 ms, line 294) | **failed again**: same error, expected `http://rosewood-1791099539055.verified.test:3100/?from=managed`, received `http://rosewood-weddings.yayatoh.events:3100/?from=managed` |
| 5 | `e2e/program.spec.ts:95` sessions: rooms and tracks, validations, room conflict warning, edit and delete | `Test timeout of 30000ms exceeded.` / `expect(locator).toHaveCount(expected) failed`, locator `[data-session="Panel"]`, expected 0, received 1 (line 177, after `Delete Panel` click) | passed (41.6 s) |
| 6 | `e2e/seat-assignment.spec.ts:129` drag and drop: name dropped on a table or one seat | `expect(locator).toHaveText(expected) failed`, locator `[aria-live="polite"]` `getByRole('status')`, expected `Seated 1 person at Table 2.`, `element(s) not found` (timeout 5000 ms, line 165) | **failed again**: same error (`Expected: "Seated 1 person at Table 2."`, element(s) not found) |

Tests 1, 2, 3 and 5 timed out at 30 s in the full run and passed alone, which fits load (2 workers, 3 projects) rather than a product bug. Tests 4 and 6 fail deterministically on this SHA on `desktop-1280`. They were not run on the other projects in isolation.

No product or test code was changed. Traces are in `apps/web/test-results/` on the helper session only (not committed).
