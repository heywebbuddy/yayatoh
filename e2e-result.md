# e2e result: batch 3l, shard 2/3

- SHA: 51d3183305d2cbbd7cebf62361c99cd2b69b8bd1
- Command: `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (3 projects, 2 workers, headless shell, Node 24.21.0, fresh DB, web + admin built)
- Total 994 tests: **959 passed, 4 failed, 31 skipped, 0 flaky** (1.7 h)
- All 4 failures were on `tablet-768`. Each passed on a solo rerun (`--project=tablet-768`).

| # | Test | Error in the shard run | Solo rerun |
|---|---|---|---|
| 1 | `e2e/distribution.spec.ts:21` ticket distribution › an organizer sends a ticket; the guest claims it; the old QR is rejected; the holder passes it on | `Test timeout of 30000ms exceeded.` | passed (41.8s) |
| 2 | `e2e/program.spec.ts:437` program (M1.4f) › Arabic: program pages, the public sections and a speaker page render right-to-left | `Test timeout of 30000ms exceeded.` | passed (36.8s) |
| 3 | `e2e/sponsorship.spec.ts:140` sponsor packages and deliverables (M5.4b) › package terms with validation, grant by keyboard, exhibitor link, contact invite; axe light/dark, RTL | `Error: expect(locator).toBeVisible() failed` at sponsorship.spec.ts:188:55. Locator: `li` filtered by heading `Acme 1791098233247768`, `.getByText('Exhibitor saved.')`. Expected visible, timeout 5000ms, element(s) not found. | passed (40.7s) |
| 4 | `e2e/webhooks.spec.ts:142` webhooks console (M6.3b) › a failing receiver: failed delivery with a retry time, fixed URL, resend and recover | `Error: expect(locator).toBeVisible() failed` at webhooks.spec.ts:162:69. Locator: `getByText('Resent', { exact: true }).first()`. Expected visible, timeout 5000ms, element(s) not found. | passed (28.7s) |

The 30 s timeouts (1, 2) and the 5 s expectations (3, 4) look like load-related slowness on the tablet project. All four passed alone, but the shard run did not pass them.
