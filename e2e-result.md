# e2e result: shard 2/3, batch 3w2

- SHA: 1000091efefb844cc64003f56bf6ffefdad5d868
- Command: `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (3 projects, 2 workers, Node 24.21, fresh DB, web and admin built)
- Services running: Postgres (pgvector pg18), Redis 7, Mailpit. **Gotenberg was NOT running** (the launch prompt named only these three), so PDF endpoints returned 503; most failures below are that.
- Note: the container worker restarted once at test ~291; the run was restarted from zero on a freshly recreated DB. Counts below are from the complete second run (2.3h).
- Counts: 1036 passed, 28 failed, 31 skipped, 6 did not run, 0 flaky reported. All 28 failures are on [tablet-768].
- Solo reruns (one rerun each, `--project=tablet-768`): 9 passed alone, 19 failed alone.

## Failures

### e2e/agenda.spec.ts:83 — agenda v2 (M5.2a) › session types, included vs optional, a pick-one group and the room warning, by keyboard
- Full run: Test timeout of 30000ms exceeded. / Error: page.evaluate: Test timeout of 30000ms exceeded.
- Solo rerun: exit 0 / 1 passed (51.0s)

### e2e/analytics-pro.spec.ts:336 — scheduled PDF reports (M6.2b) › schedule (keyboard only), send once per period, download, edit, switch off, delete
- Full run: Error: expect(locator).toContainText(expected) failed / Expected substring: "Sent"
- Solo rerun: exit 1 / Error: expect(locator).toContainText(expected) failed / Expected substring: "Sent" / Received string:    "Weekly sales muukxx7wtSep 21 – 27, 2026WaitingNot ready" / 1 failed

### e2e/attendees.spec.ts:7 — attendees: labels, filters and org-wide search › an organizer labels a guest, filters by label, and finds people by name or ticket code
- Full run: Test timeout of 30000ms exceeded. / Error Context: test-results/attendees-attendees-labels-94e92-ople-by-name-or-ticket-code-tablet-768/error-context.md
- Solo rerun: exit 0 / 1 passed (47.8s)

### e2e/badge-printing.spec.ts:67 — badge printing and print log (M5.5b) › printers, station heartbeat and offline, print and reprint with reasons, the log; viewer and Arabic
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/badges.spec.ts:79 — badges (M5.5a) › design by keyboard, assign to a ticket type, batch PDF by company, download; viewer and Arabic
- Full run: Error: expect(locator).toBeVisible() failed / Expected: visible
- Solo rerun: exit 1 / Error: expect(locator).toBeVisible() failed / Expected: visible / Error: element(s) not found / 1 failed

### e2e/ce-credits.spec.ts:94 — an owner sets CE rules and calculates; the attendee receives, downloads and verifies the certificate
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/ce-credits.spec.ts:346 — Arabic (RTL): the CE page, the certificate and its verification
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/checkin.spec.ts:22 — check-in › door staff admit a ticket once, see the duplicate, undo, and reject a bad code
- Full run: Test timeout of 30000ms exceeded. / Error: locator.fill: Test timeout of 30000ms exceeded.
- Solo rerun: exit 0 / 1 passed (50.9s)

### e2e/checkout.spec.ts:7 — checkout › a guest buys a free ticket and a paid ticket through the test payment page
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/coupons-currency.spec.ts:44 — org-wide coupons › an org coupon is made on the Coupons page, redeemed at checkout and counted; one use per buyer
- Full run: Test timeout of 30000ms exceeded. / Error Context: test-results/coupons-currency-org-wide--2428f-d-counted-one-use-per-buyer-tablet-768/error-context.md
- Solo rerun: exit 0 / 1 passed (51.2s)

### e2e/dates.spec.ts:326 — multi-date events › the scanner admits a ticket on its own date and rejects it on another
- Full run: Test timeout of 30000ms exceeded. / Error: browserContext.newPage: Protocol error (Target.createTarget): Failed to find browser context with id D1CE921A1251EDA2129F781B4FE72B7C
- Solo rerun: exit 0 / 1 passed (48.8s)

### e2e/dispute-response.spec.ts:11 — dispute response (M1.6e) › build, review, edit and submit an evidence packet
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/disputes.spec.ts:8 — disputes › a card dispute shows on the order with a downloadable evidence packet
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/distribution.spec.ts:21 — ticket distribution › an organizer sends a ticket; the guest claims it; the old QR is rejected; the holder passes it on
- Full run: Test timeout of 30000ms exceeded. / Error Context: test-results/distribution-ticket-distri-f16a5-ted-the-holder-passes-it-on-tablet-768/error-context.md
- Solo rerun: exit 0 / 1 passed (52.8s)

### e2e/email-kind-labels.spec.ts:24 — the Emails page labels every email kind in /ar
- Full run: Error: expect(locator).toBeVisible() failed / Expected: visible
- Solo rerun: exit 0 / 2 passed (40.0s)

### e2e/event-content.spec.ts:87 — page content, announcements and access (M1.4d) › sections: add with validation, reorder by keyboard and by drag, FAQ and sanitized text render publicly
- Full run: Test timeout of 30000ms exceeded. / Error Context: test-results/event-content-page-content-fb8d4-itized-text-render-publicly-tablet-768/error-context.md
- Solo rerun: exit 0 / 1 passed (45.1s)

### e2e/form-controls.spec.ts:51 — the chevron sits inside the field › visual snapshot: the three sizes in LTR and RTL
- Full run: Error: expect(locator).toHaveScreenshot(expected) failed / Expected an image 656px by 82px, received 656px by 83px.
- Solo rerun: exit 1 / Error: expect(locator).toHaveScreenshot(expected) failed / Expected an image 656px by 82px, received 656px by 83px. / - Expected an image 656px by 82px, received 656px by 83px. / - Expected an image 656px by 82px, received 656px by 83px. / Expected: e2e/form-controls.spec.ts-snapshots/select-sizes-light-chromium-tablet-768-linux.png / Received: test-results/form-controls-the-chevron--179f0--three-sizes-in-LTR-and-RTL-tablet-768/select-sizes-light-actual.png

### e2e/invoices.spec.ts:145 — register with pay later and a PO, get the invoice and its PDF by email, pay half by link
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: locator.fill: Test ended. / 1 failed

### e2e/kiosk-print.spec.ts:160 — kiosk self-print (M5.5c) › scan, check your details, print once; the desk for a second print; email code; offline; never another attendee; log; Arabic
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/p6-journeys-b.spec.ts:388 — journey: virtual (delivery, playback, Zoom, CE) › hybrid setup, watching, provider switch, Zoom webinar, CE certificate, Arabic
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/privacy.spec.ts:164 — privacy requests (DSAR) in the console › erasure: confirmation, the signed receipt with legal holds, the PDF, nothing left to find
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/receipts.spec.ts:255 — charity profile and receipts (M4.8b) › a donor gives and receives the receipt in the dev mailbox, with the PDF; the host sees it
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/seating-cards.spec.ts:96 — cards and exports (M4.3b) › keyboard only: cards as PDF in English and Arabic, chart and meal counts as CSV and XLSX
- Full run: Test timeout of 150000ms exceeded. / Error: page.waitForEvent: Test timeout of 150000ms exceeded.
- Solo rerun: exit 1 / Error: page.waitForEvent: Test timeout of 150000ms exceeded. / 1 failed

### e2e/seating-cards.spec.ts:202 — cards and exports (M4.3b) › empty states: no plan, then nobody seated (inline error, no download)
- Full run: Test timeout of 120000ms exceeded. / Error: page.waitForEvent: Test timeout of 120000ms exceeded.
- Solo rerun: exit 1 / Error: page.waitForEvent: Test timeout of 120000ms exceeded. / 1 failed

### e2e/seating-cards.spec.ts:245 — cards and exports (M4.3b) › a viewer prints cards but never sees or reaches the exports
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/support-tools.spec.ts:286 — support tools (M3.10c) › issue a credit note, download its PDF; the buyer spends the store credit
- Full run: Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503
- Solo rerun: exit 1 / Error: expect(received).toBe(expected) // Object.is equality / Expected: 200 / Received: 503 / 1 failed

### e2e/support-tools.spec.ts:375 — support tools (M3.10c) › work a dispute from the queue and submit its evidence; deadline alerts
- Full run: Error: expect(locator).toBeVisible() failed / Expected: visible
- Solo rerun: exit 1 / Error: expect(locator).toBeVisible() failed / Expected: visible / Error: element(s) not found / 1 failed / ALLDONE

### e2e/webhooks.spec.ts:37 — webhooks console (M6.3b) › add an endpoint, send a test, see the signed delivery, then delete it
- Full run: Test timeout of 30000ms exceeded. / Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
- Solo rerun: exit 0 / 1 passed (41.2s)
