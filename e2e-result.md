# e2e shard 3/3 result (batch 3m)

- SHA: 92621e32573247b79b21c975ec881ca97b95ec66
- Command: `cd apps/web && npx playwright test --shard=3/3 --reporter=line --workers=2` (Node 24.21.0, fresh DB, web+admin built, Postgres pgvector:pg18, Redis, Mailpit, Gotenberg up). Note: browser used was /opt/pw-browsers/chromium-1194 (log shows chromium-1194, not the headless shell).
- Result: 1085 tests in shard; **1080 passed, 5 failed, 0 skipped, 0 flaky** (2.0 h)

## Failures and solo reruns
Rerun: `--project=desktop-1280 --workers=1` on the 5 specs together (one test at a time). Result: 4 passed, 1 failed.

1. `[desktop-1280] e2e/coupons-currency.spec.ts:44` org-wide coupons › an org coupon is made on the Coupons page, redeemed at checkout…
   - Error: Test timeout of 30000ms exceeded. `expect(locator).toContainText` at line 106: row `ORGMUTI1Z3Y1280` expected "Active", received "ORGMUTI1Z3Y1280Org couponLakeside Open House25% off1 / 51No end datePausedResume" (still Paused after clicking Resume).
   - Solo rerun: PASSED.
2. `[desktop-1280] e2e/event-content.spec.ts:87` sections: add with validation, reorder by keyboard and by drag, FAQ and sanitized text render publicly
   - Error: Test timeout of 30000ms exceeded (no assertion message captured).
   - Solo rerun: PASSED.
3. `[desktop-1280] e2e/marketplace.spec.ts:276` tenant sites › a custom primary domain takes over: the managed subdomain 308s to it
   - Error: `expect(page).toHaveURL` failed at marketplace.spec.ts:294. Expected `http://rosewood-1791100923497.verified.test:3100/?from=managed`, received `http://rosewood-weddings.yayatoh.events:3100/?from=managed` (no 308 happened within 5000ms).
   - Solo rerun: FAILED, same error (the expected URL host in the log is identical to the first run's, suggesting the test's host value and the same failure).
4. `[desktop-1280] e2e/sending-setup.spec.ts:120` sending setup › a failing DKIM is shown; a domain another organization uses is refused
   - Error: Test timeout of 30000ms exceeded (no assertion message captured).
   - Solo rerun: PASSED.
5. `[desktop-1280] e2e/webhooks.spec.ts:37` webhooks console › add an endpoint, send a test, see the signed delivery, then delete it
   - Error: Test timeout of 30000ms exceeded in `locator.click`: waiting for getByRole('button', { name: 'Delete endpoint' }) (webhooks.spec.ts:30, called from line 76).
   - Solo rerun: PASSED.

All five failures were on the desktop-1280 project. The server log showed repeated `⨯ Error: The destination stream closed early.` (digest 909691340) during the run.
Only failure 3 is reproducible solo; 1, 2, 4 and 5 passed alone (load/race candidates).
