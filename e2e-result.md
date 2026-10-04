# e2e shard 3/3 result

- SHA: 89b457b440f563181221a8f757f9f2e5eac67edb
- Command: `cd apps/web && npx playwright test --shard=3/3 --reporter=line` (3 projects, 2 workers, headless shell, fresh DB, web + admin built)
- Total in shard: 920 tests. **914 passed, 6 failed, 0 skipped, 0 flaky** (1.9 h). All 6 failures were in `desktop-1280`.

## Failures (first run) and solo rerun (`--project=desktop-1280`, one test alone)

1. `e2e/channels-layouts.spec.ts:37` "an organizer allots a block to a promoter code; buyers buy it only through the promoter's link; viewers read only…"
   - Error: `expect(locator).toBeDisabled() failed` — Locator `getByRole('checkbox', { name: /^Row A · 1 \(/ })`, Expected: disabled, Timeout 5000ms, `element(s) not found`.
   - Solo rerun: **passed** (50.1s).
2. `e2e/channels-layouts.spec.ts:180` "every save is a revision; an organizer rolls back by keyboard; held seats stop a restore that would lose them"
   - Error: `Test timeout of 180000ms exceeded.` / `locator.check: Test ended.` waiting for `getByRole('checkbox', { name: /^Row A · 1 \(/ })` at `seating-helpers.ts:122` (`holdSeats`).
   - Solo rerun: **passed** (43.4s).
3. `e2e/date-charts.spec.ts:58` "give date 2 its own chart by keyboard, then sell the same seat on both dates"
   - Error: `expect(locator).toBeVisible() failed` — `getByText('8 of 8 seats have a price')`, Timeout 5000ms, `element(s) not found`.
   - Solo rerun: **passed** (48.9s).
4. `e2e/guest-site.spec.ts:57` "builds the site from blocks: every validation named, publish needs a password, saved after a reload"
   - Error: `Test timeout of 30000ms exceeded.` / `expect(locator).toBeVisible() failed` — `getByText('Published. Share the address and the password with your guests.')`, `element(s) not found`.
   - Solo rerun: **passed** (50.2s).
5. `e2e/seat-assignment.spec.ts:129` "drag and drop: a name dropped on a table or on one seat of the plan"
   - Error: `expect(locator).toHaveText(expected) failed` — Locator `locator('[aria-live="polite"]').getByRole('status')`, Expected `"Seated 1 person at Table 2."`, Timeout 5000ms, `element(s) not found` (at `seat-assignment.spec.ts:165`, after `dropAt(dee, 730, 830)`).
   - Solo rerun: **FAILED again with the identical error** (run twice solo, same result both times). Not load-related.
6. `e2e/tracked-links.spec.ts:325` "a viewer reads links and results but cannot create them; a stale form is refused"
   - Error: `Test timeout of 30000ms exceeded.` / `locator.fill: Test timeout of 30000ms exceeded.` waiting for `getByRole('region', { name: 'Create a tracked link' }).getByLabel('Medium', { exact: true })` (line 356).
   - Solo rerun: **passed** (28.8s, close to the 30 s timeout).

## Summary
Reproducible on the SHA: #5 (`seat-assignment.spec.ts:129`, desktop drag-drop onto table 2).
Passed solo (likely load/timing under 2 workers): #1, #2, #3, #4, #6.
No product or test code was changed.
