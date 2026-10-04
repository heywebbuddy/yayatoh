# e2e result: shard 2/3, batch 3v

- SHA: 6bec886d9a1671d9802a0c68e1e56978f73f556d
- Command: `cd apps/web && npx playwright test --shard=2/3 --reporter=line` (3 projects, 2 workers, headless shell), fresh DB, web and admin built from that SHA
- Counts (963 tests in shard): **927 passed, 5 failed, 31 skipped, 0 flaky** (1.5 h)
- Solo rerun (each failing test alone, `--project=tablet-768`): 3 passed, 2 failed again

## Failures (all `[tablet-768]`)

1. `e2e/distribution.spec.ts:21` "ticket distribution › an organizer sends a ticket; the guest claims it; the old QR is rejected; the holder passes it on"
   - Error: `Test timeout of 30000ms exceeded.` (no assertion message)
   - Solo rerun: **passed** (36.3s)

2. `e2e/giving-screen.spec.ts:223` "live giving screen (M4.8d) › the level being called and spotters' paddles climb the screen; it catches up after a drop; modes by keyboard; a replaced link stops ..."
   - Error: `expect(received).toEqual(expected)` at `helpers.ts:161` (via `expectAccessible`, called from `giving-screen.spec.ts:287`): expected `[]`, received `[{ id: "color-contrast", impact: "serious", nodes: ["button:nth-child(3)"] }]`
   - Solo rerun: **passed** (36.2s)

3. `e2e/scan-pwa.spec.ts:21` "Scan PWA › a device set up from its link scans online, keeps scanning offline, and syncs on reconnect"
   - Error: `Test timeout of 30000ms exceeded.` with `Error: page.reload: Target page, context or browser has been closed` at `scan-pwa.spec.ts:92:16`
   - Solo rerun: **passed** (29.2s)

4. `e2e/social-workspace.spec.ts:212` "wedding route sweep and vocabulary (M4.2a) › every wedding and gala screen uses the profile words"
   - Error: `expect(received).toEqual(expected)` at `social-workspace.spec.ts:224`, message `/o/rosewood-weddings/e/words-1791083364724768/command-center`: expected `[]`, received `["of 0 valid tickets"]`
   - Solo rerun: **FAILED again**, same error on `/o/rosewood-weddings/e/words-1791084733887768/command-center`: received `["of 0 valid tickets"]`

5. `e2e/social-workspace.spec.ts:237` "event team: co-hosts and planners (M4.2a, P4-8) › an owner invites a planner and a co-host; each sees exactly their pages; revoking removes access"
   - Error: `expect(received).toBe(expected)` at `social-workspace.spec.ts:343`, message `/o/e2e-mut8so29edc331/e/team-wedding-1791083374043768/details`: expected status 200, received 500
   - Solo rerun: **FAILED again**, same error on `/o/e2e-mut9mcsqfb4a99/e/team-wedding-1791084759077768/details`: expected 200, received 500

No product or test code was changed.
