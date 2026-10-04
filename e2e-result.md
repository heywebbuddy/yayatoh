# e2e result: batch 3l, shard 3/3

- SHA: `1bb85408decaa144e1872394a9813440a75007c8`
- Command: `cd apps/web && npx playwright test --shard=3/3 --reporter=line` (3 projects, 2 workers, headless shell, fresh DB, web and admin built, Postgres/Redis/Mailpit/Gotenberg running)
- Shard size: 994 tests
- Counts: **987 passed, 7 failed, 0 skipped, 0 flaky** (1.8 h)
- Solo reruns (each failing test alone, `--project=desktop-1280 --workers=1`): **3 failed again, 4 passed**
- All 7 failures are in project desktop-1280.

| # | Test | Full-run error | Solo rerun |
|---|------|----------------|------------|
| 1 | `channels-layouts.spec.ts:180` every save is a revision; an organizer rolls back by keyboard; held seats stop a restore that would lose them | `Test timeout of 180000ms exceeded.` / `Error: locator.check: Test ended.` waiting for `getByRole('checkbox', { name: /^Row A · 1 \(/ })` (seating-helpers.ts:122, holdSeats, called from channels-layouts.spec.ts:230) | PASSED (46.6s) |
| 2 | `event-content.spec.ts:87` sections: add with validation, reorder by keyboard and by drag, FAQ and sanitized text render publicly | `Test timeout of 30000ms exceeded.` (no assertion line printed) | PASSED (37.0s) |
| 3 | `giving-screen.spec.ts:223` the level being called and spotters' paddles climb the screen; it catches up after a drop; modes by keyboard; a replaced link stops | axe `expectAccessible` (helpers.ts:161): `[{ id: "color-contrast", impact: "serious", nodes: ["button:nth-child(3)"] }]` | PASSED (44.6s) |
| 4 | `seat-assignment.spec.ts:129` drag and drop: a name dropped on a table or on one seat of the plan | `expect(locator).toHaveText` at seat-assignment.spec.ts:165: locator `[aria-live="polite"]` getByRole('status'), expected "Seated 1 person at Table 2.", `element(s) not found` after 5000ms | FAILED again, same error (line 165, same locator, element(s) not found) |
| 5 | `step-up.spec.ts:85` cancelling (Escape) keeps what was typed and says why; submitting again asks again | `expect(locator).toHaveAttribute` (helpers.ts:320 expectPicked, step-up.spec.ts:100): `getByLabel('Role', { exact: true })` expected `data-value` "finance", received "manager" | FAILED again, same error (expected "finance", received "manager") |
| 6 | `step-up.spec.ts:315` refunding a whole order asks first; the typed choices are kept on cancel | `expect(locator).toHaveAttribute` (helpers.ts:320, step-up.spec.ts:333): Refund region `getByLabel('Reason')` expected `data-value` "duplicate", received "requested_by_customer" | FAILED again, same error (received "requested_by_customer") |
| 7 | `webhooks.spec.ts:142` a failing receiver: failed delivery with a retry time, fixed URL, resend and recover | `expect(locator).toBeVisible` at webhooks.spec.ts:162: `getByText('Resent', { exact: true }).first()` `element(s) not found` after 5000ms | PASSED (30.7s) |

Notes: tests 4, 5 and 6 failed again on solo rerun with the same errors. In 5 and 6 the select/picker value chosen before the step-up cancel reads back as the default. Tests 1, 2, 3 and 7 passed on solo rerun. No product or test code was changed.
