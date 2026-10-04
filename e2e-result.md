# e2e result: batch 3l, shard 2/3

- SHA: 1bb85408decaa144e1872394a9813440a75007c8
- Command: `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (fresh DB, web and admin built, 3 projects, 2 workers, headless shell)
- Total 994 tests: **955 passed, 8 failed, 31 skipped, 0 flaky** (1.6 h)
- Solo rerun (each failing test alone, `--project=tablet-768 --workers=1`): 6 passed, 2 failed again

All 8 failures were in the `tablet-768` project.

| # | Test | Error in the shard run | Solo rerun |
|---|---|---|---|
| 1 | e2e/guest-site.spec.ts:57 builds the site from blocks... | `Test timeout of 30000ms exceeded.` `frame.evaluate: Test timeout of 30000ms exceeded.` in `expectAccessible` (helpers.ts:147, AxeBuilder.analyze), called from guest-site.spec.ts:150 | passed |
| 2 | e2e/leads.spec.ts:227 offline: scans queue on the device... | `expect(locator).toHaveText(expected) failed`: `getByTestId('leads-network')`, expected `/^Offline/`, received `"Online"` (leads.spec.ts:244) | passed |
| 3 | e2e/rsvp.spec.ts:159 the host copies the link, prints the QR code... | `expect(locator).toBeVisible() failed`: `getByText('New link made. Old links and QR codes no longer work.')` not found (rsvp.spec.ts:207) | passed |
| 4 | e2e/series-templates.spec.ts:34 create a series... | `expect(page).toHaveURL(expected) failed`: expected `/\?series=/`, received `http://localhost:3100/o/lakeside-events` (series-templates.spec.ts:80) | passed |
| 5 | e2e/series-templates.spec.ts:129 duplicating an event copies its setup but never its orders | `Test timeout of 30000ms exceeded.` `expect(locator).toHaveCount(expected)` on `getByRole('row').filter({ hasText: 'Ada tablet768...' })`: `Protocol error (Runtime.callFunctionOn): Internal server error, session closed.` (series-templates.spec.ts:167) | passed |
| 6 | e2e/step-up.spec.ts:85 cancelling (Escape) keeps what was typed... | `expect(locator).toHaveAttribute(expected) failed`: `getByLabel('Role', { exact: true })` expected `data-value` `"finance"`, received `"manager"` (helpers.ts:320 `expectPicked`) | **failed again**, same error (expected `"finance"`, received `"manager"`) |
| 7 | e2e/step-up.spec.ts:315 refunding a whole order asks first... | `expect(locator).toHaveAttribute(expected) failed`: `getByRole('region', { name: 'Refund', exact: true }).getByLabel('Reason')` expected `data-value` `"duplicate"`, received `"requested_by_customer"` (helpers.ts:320 `expectPicked`) | **failed again**, same error (expected `"duplicate"`, received `"requested_by_customer"`) |
| 8 | e2e/webhooks.spec.ts:142 a failing receiver... | `expect(locator).toBeVisible() failed`: `getByText('Resent', { exact: true }).first()` not found (webhooks.spec.ts:162) | passed |

Notes (observations only, no code changed):
- Failures 6 and 7 reproduce alone on tablet-768 with the same error: the picker's `data-value` is back at its default when the test reads it after Escape/cancel on the step-up dialog.
- Failures 1–5 and 8 passed alone; the web server logged many `The destination stream closed early.` lines during the run.
- Env: Docker Hub pulls were rate-limited; images were pulled through mirror.gcr.io and tagged to the compose names. Postgres 18, Redis 7, Mailpit and Gotenberg were running. Node v24.21.0.
