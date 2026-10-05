# e2e shard 3/3 result (batch 3w2)

SHA: 1000091efefb844cc64003f56bf6ffefdad5d868
Command: `cd apps/web && npx playwright test --shard=3/3 --reporter=line` (3 projects, 2 workers, headless shell, fresh DB, web+admin built)

## Counts (shard run)
- 1076 passed, 19 failed, 6 did not run, 0 skipped, 0 flaky
- All 19 failures are `[desktop-1280]`.
- The first attempt was killed by a worker restart at test ~137; the DB was recreated and the shard restarted from scratch. This result is the second, complete run.
- Gotenberg was NOT running during the shard (only Postgres, Redis and Mailpit were started, as the launch prompt said). The logs show `cards pdf / credit note pdf [TypeError: fetch failed]` and PDF endpoints returning 503. Most failures below are PDF tests. After the shard I started Gotenberg (gotenberg/gotenberg:8.37.0) and reran each failing test alone.

## Failures (shard run) and solo rerun result (desktop-1280, Gotenberg up)
| Test | Shard-run error | Solo rerun |
|---|---|---|
| analytics-pro.spec.ts:336 scheduled PDF reports | `expect(locator).toContainText(expected) failed` (Timeout 5000ms) | passed |
| badge-printing.spec.ts:67 | `expect(received).toBe(expected)` | passed |
| badges.spec.ts:79 | `expect(locator).toBeVisible() failed`, element(s) not found (30000ms) | passed |
| ce-credits.spec.ts:94 | `expect(received).toBe(expected)` | passed |
| ce-credits.spec.ts:346 (Arabic) | `expect(received).toBe(expected)` | passed |
| checkout.spec.ts:7 | `expect(received).toBe(expected)` | passed |
| dispute-response.spec.ts:11 | `expect(received).toBe(expected)` | passed |
| disputes.spec.ts:8 | `expect(received).toBe(expected)` | passed |
| form-controls.spec.ts:51 visual snapshot | `expect(locator).toHaveScreenshot(expected) failed`: Expected an image 1168px by 82px, received 1168px by 83px (select-sizes-light.png) | FAILED again, same error |
| invoices.spec.ts:145 | `expect(received).toBe(expected)`: expected 200, received 503 on `GET {invoicePath}/pdf?locale=en` (invoices.spec.ts:198) | FAILED again (3 solo runs): `locator.fill: Test ended.` while waiting for `getByLabel('Your email')` at invoices.spec.ts:65 (called from :151). The registration page never showed the field before the test timeout. State left by the earlier failed run on the used DB is a possible cause; not verified on a fresh DB. |
| kiosk-print.spec.ts:160 | `expect(received).toBe(expected)` | passed |
| p6-journeys-b.spec.ts:388 | `expect(received).toBe(expected)` | passed |
| privacy.spec.ts:164 | `expect(received).toBe(expected)` | passed |
| receipts.spec.ts:255 | `expect(received).toBe(expected)` | passed |
| seating-cards.spec.ts:96 | `page.waitForEvent: Test timeout of 150000ms exceeded` | passed |
| seating-cards.spec.ts:202 | `page.waitForEvent: Test timeout of 120000ms exceeded` | passed |
| seating-cards.spec.ts:245 | `expect(received).toBe(expected)` | passed |
| support-tools.spec.ts:286 | `expect(received).toBe(expected)` | passed |
| support-tools.spec.ts:375 | `expect(locator).toBeVisible() failed` (Timeout 5000ms) | passed |

Summary: 17 of 19 pass alone once Gotenberg is up, so they were caused by the missing service. Still failing after the solo rerun: form-controls.spec.ts:51 (1px height difference against the committed `select-sizes-light-shell-desktop-1280-linux.png`; either a renderer/font difference in this container or a real layout change) and invoices.spec.ts:145 (see above).

"6 did not run": Playwright did not list their names in the summary.
