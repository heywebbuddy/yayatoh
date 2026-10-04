# E2E result: batch 3k, shard 2/3

- **SHA:** 89b457b440f563181221a8f757f9f2e5eac67edb
- **Command:** `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (3 projects, 2 workers; fresh DB; web and admin built with `pnpm --filter ... build`)
- **Duration:** 1.2 h
- **Counts (920 test runs):** 886 passed, 3 failed, 31 skipped, 0 flaky (as reported by Playwright)
- **Solo reruns:** all 3 failures passed when rerun alone once (`--project=tablet-768`)

## Failures (all `[tablet-768]`, all passed on solo rerun)

1. `e2e/leads.spec.ts:227` "lead retrieval (M5.6b) › offline: scans queue on the device and sync exactly once when the network is back"
   ```
   Error: expect(locator).toBeVisible() failed
   Locator: getByText('Saved on this device')
   Error: strict mode violation: getByText('Saved on this device') resolved to 2 elements:
       1) <span data-testid="leads-network">Offline: scans are saved on this device</span> aka getByTestId('leads-network')
       2) <p class="m-0 text-[24px] leading-tight font-extrabold">Saved on this device</p> aka getByText('Saved on this device', { exact: true })
   at e2e/leads.spec.ts:246
   ```
   Solo rerun: **passed** (55.3 s).

2. `e2e/realtime.spec.ts:226` "realtime channels (M3.1b) › tenant hosts serve only their own org's channels, on either path"
   ```
   Error: expect(page).toHaveURL(expected) failed
   Expected pattern: /\/o\/lakeside-events\/e\/live-doors-[a-z0-9-]+$/
   Received string:  "http://localhost:3100/o/lakeside-events/events/new"
   Timeout: 5000ms
   at doorsEvent (e2e/realtime.spec.ts:36) after clicking "Create draft"
   ```
   Solo rerun: **passed** (26.1 s).

3. `e2e/waitlist.spec.ts:147` "waitlists (M3.10a) › join from the sold-out page, the organizer frees a ticket, the guest gets and uses the offer"
   ```
   Error: expect(page).toHaveURL(expected) failed
   Expected pattern: /\/orders\//
   Received string:  "http://localhost:3100/waitlist/01a10554-2827-7e19-ae20-67f502dd6dd9~YhUuGFJbdXUBkootUMXrJ08u1h03vC9-T61mD09dQ8A"
   Timeout: 5000ms
   at e2e/waitlist.spec.ts:188
   ```
   Solo rerun: **passed** (31.3 s).

Pattern: two of the three are 5 s `toHaveURL` timeouts right after a form submit (consistent with a slow server action under 2-worker load); the third is a strict-mode locator ambiguity (the offline banner and the saved-scan card both contain the text). No product or test code was changed.
