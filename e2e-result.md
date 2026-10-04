# E2E shard 2/3 result

- SHA: 66d6010e03a85d531071053efb4a73140b86903b
- Command: `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (3 projects, 2 workers, headless shell, Node 24.21.0, fresh DB)
- Total 963 tests: **928 passed, 4 failed, 31 skipped, 0 flaky** (1.6 h)
- Every failure was on [tablet-768]; each passed when rerun alone once (`--project=tablet-768`).

## Failures

1. `e2e/notifications.spec.ts:32` "a purchase emails the tickets; the buyer and the organizer see it in the order's message log"
   - Error: `Test timeout of 30000ms exceeded.` / `apiRequestContext.post: Test timeout of 30000ms exceeded.` on `POST http://localhost:3100/api/dev/login`
   - Solo rerun: PASSED (30.9 s)
2. `e2e/security.spec.ts:282` "rate limits › holder magic link: a localized 429 after 10 requests from one device"
   - Error: `Test timeout of 30000ms exceeded.` / `expect(locator).toBeVisible() failed` — `getByText('If that email has tickets for this event, a link is on its way.')`, Expected: visible, Received: undefined (timeout 5000ms, security.spec.ts:293)
   - Solo rerun: PASSED (26.3 s)
3. `e2e/template-builder.spec.ts:35` "build a template from scratch and create an event with exactly its contents"
   - Error: `expect(locator).toHaveCount(expected) failed` — `getByRole('region', { name: 'Default ticket types' }).getByRole('list', { name: 'Ticket types' }).getByRole('listitem')`, Expected: 2, Received: 1 (timeout 5000ms)
   - Solo rerun: PASSED (41.7 s)
4. `e2e/template-builder.spec.ts:212` "save an event as a template from the event header"
   - Error: `Test timeout of 30000ms exceeded.` (no assertion message in the line reporter; trace at test-results/template-builder-template--33b39-plate-from-the-event-header-tablet-768/trace.zip)
   - Solo rerun: PASSED (23.9 s)

The server log also showed many `⨯ Error: The destination stream closed early.` (digest 909691340) lines during the run.
