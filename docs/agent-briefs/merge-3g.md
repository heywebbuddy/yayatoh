You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3g. It completes Phase 3's features. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
You start on the build branch `m0.5-foundation-ey5gqp` (it carries `.claude/settings.json`). Batches 3e and 3f are still finishing on stacked branches, so build on top of 3f:
```
git fetch origin && git checkout -B merge/next-3g origin/m0.5-foundation-ey5gqp && git merge --no-edit origin/merge/next-3f
```
- Publish with a normal push: `git push -u origin merge/next-3g`.
- Never push to any other branch. Never force-push. Never open PRs.
- Before your final gate, fetch and merge the latest `origin/merge/next-3f` and `origin/m0.5-foundation-ey5gqp` again, with normal merges.
- Use the commit attribution your system prompt gives. Your final commit's message is your full report.

## Merge these branches, one at a time, in this order, with merge commits
1. `origin/agent/m3.3a`: Command Center live mode (live widgets, TV display links, staff presence, worker watchdog, live-critical escalation). Brief `docs/agent-briefs/m3.3a.md`.
2. `origin/agent/m3.3b`: guest assistance queue (requests, SLA, priority, Command Center widget, console queue, guest help, Scan PWA help). Brief `m3.3b.md`.
3. `origin/agent/m3.8b`: marketing analytics (attribution credit, ranges, rates, tiles, campaign drill-down). Brief `m3.8b.md`.

**None of the three has a final report commit:** their sessions were stopped at the usage limit. Their code, unit/integration tests and their own e2e specs are pushed. Read each branch's commits and brief. Finish anything the brief's acceptance criteria still lack, and run each branch's own tests as part of your gate. List in your report what you had to finish.

## Merge procedure
Follow the "Merge procedure (house rules)" section of `docs/agent-briefs/merge-3e.md` exactly:
- renumber migrations on the chain so that `db:generate` shows no changes
- hand-written blocks verbatim
- NOT VALID + VALIDATE
- three-way message union in all 13 locales
- impersonation, canary, fixture and freeze-mode wiring for new commands and tables
- route ownership for new public routes (TV display links, guest help)
- `/v1` additive, with Spectral and the SDK regenerated
- the lockfile regenerated with pnpm only

Specific wiring for this batch:
- M3.3a's live widgets and M3.3b's assistance widget both register on M3.2a's Command Center shell. Keep one widget registry, and keep each profile's layout coherent.
- M3.3b's alert rule and M3.3a's live-critical escalation go through M3.2b's alert engine via outbox subscribers. Each rule raises exactly one alert in a test.
- M3.8b's tiles read M3.6b campaigns and M3.1a metrics through public exports only.
- The staff presence ping (M3.3a) and Scan PWA help (M3.3b) both touch M3.4a's staff mode. Keep one staff screen.

## Design v2
The owner approved a new design system (`docs/decisions.md` 2026-10-02). It is being built on `agent/design-v2` and will land after you. Don't restyle anything. Keep UI on the existing `@yayatoh/ui` components and tokens (no raw colours) so the restyle reaches every page.

## Known flaky test
`[desktop-1280] e2e/widget.spec.ts:48` failed once in batch 3d from the container's OOM killer, then passed 15/15 alone. If it fails again, record the exact error, rerun it alone with `--repeat-each=5`, and look for a real cause before calling it flaky.

## Environment and gate
As in `merge-3e.md`:
- environment setup steps 1–5
- `pnpm verify`
- `db:generate` shows no changes
- `contracts:check`
- the WHOLE web e2e suite on a fresh DB (3 projects, 2 workers, headless shell), then the admin suite
- the new specs of these branches once on the headless shell

Never weaken, skip or delete a test.

## Report (final commit message)
- branches merged
- what you finished for each branch without a report
- migrations renumbered (old → new) and every hand-written edit
- conflicts and resolutions
- wiring and fixes added
- gate numbers (unit/int/e2e web/admin, contracts)
- owner items left open (point to `docs/owner-inbox.md`)
- anything flaky, with exact errors

Then stop.
