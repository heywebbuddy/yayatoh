You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3j: the **Phase 4 Wave C** and **Phase 5 Wave 3** builders, merged on top of batch 3h and design system v2. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
You start on the build branch `m0.5-foundation-ey5gqp`. It carries batches 3c–3h **and design v2**.
- If `git merge-base --is-ancestor origin/merge/next-3h origin/m0.5-foundation-ey5gqp` fails, stop and report: batch 3h must land first.
- `git fetch origin && git checkout -B merge/next-3j origin/m0.5-foundation-ey5gqp`
- Publish with a normal push: `git push -u origin merge/next-3j`. Never push to any other branch. Never force-push. Never open PRs.
- Every couple of hours, and **before your final gate**, fetch and merge the latest `origin/m0.5-foundation-ey5gqp` again.
- **Parallel batch:** batch 3i (Phase 6 Wave 1) runs at the same time on the same base. Whichever of you finishes second must merge the newest build branch (with the other batch landed), renumber migrations on top of it and rerun the gate. Say in your report whether 3i had landed.

## Merge these branches, one at a time, in this order, with merge commits
The orchestrator lists the final set in your launch prompt (only builders that reported). The expected order (bases before the branches stacked on them):
1. `origin/agent/m4.3a`: guest seating editor (guests, seating)
2. `origin/agent/m4.3b`: place/escort/table cards and seating exports (stacked on m4.3a)
3. `origin/agent/m4.4a`: guest seat finder, party QR, PIN mode (stacked on m4.3a)
4. `origin/agent/m4.4b`: kiosk, TV board and check-in for seated events (stacked on m4.3a, m4.4a)
5. `origin/agent/m4.5a`: guest website
6. `origin/agent/m4.5b`: gallery (stacked on m4.5a)
7. `origin/agent/m4.7a`: mobile-web guest hub (stacked on m4.5a)
8. `origin/agent/m4.8c`: paddle raise console and spotters (donations)
9. `origin/agent/m4.8d`: live giving screen and QR-to-give (stacked on m4.8c)
10. `origin/agent/m4.8e`: cards on file and pledge collection (stacked on m4.8c, m4.4a)
11. `origin/agent/m4.8f`: matching gifts (merged m4.8c)
12. `origin/agent/m5.3b`: call for papers
13. `origin/agent/m5.4b`: sponsor packages and deliverables
14. `origin/agent/m5.5b`: printing and print log
15. `origin/agent/m5.6a`: session check-in
16. `origin/agent/m5.7b`: feedback and engagement score
17. `origin/agent/m5.8a`: directory, connections and meetings
18. `origin/agent/m5.8b`: chat (stacked on m5.8a)
19. `origin/agent/m5.9a`: conference Command Center pack (stacked on m5.6a)

Each branch's last commit message is its report (migrations, hand edits, owner items): read it before merging. Stacked branches already contain their base; merge the base first anyway so conflicts are resolved once.

**Known issues from the builders' reports (fix, never skip):**
- **M5.8a documented a privacy gap** in its report. Read it and close it in this batch (tests first); say exactly what it was and how it is closed.
- **M5.9a changed the leak canary fixture** (`packages/testing/src/canary/org.ts`) and asked for review. Scrutinise it: the canary must never get weaker (no field dropped from coverage, no assertion loosened). Keep the change only if it adds coverage or fixes a genuine fixture bug; otherwise revert it and make M5.9a's code pass the original canary.
- **M5.3b** logged 6 evidence-leak gate false positives: fix the gate's precision (as 3g did for hex digests) without letting a real card number or secret through; add unit cases for each.
- **M4.8e** built the check-in QR card-saving entry against the check-in engine before M4.4b existed: wire it to M4.4b's check-in now.
- **M4.3b and M4.8f** saw a conflict between 3g and 3h in command-center `widgets.ts` (both fixed the campaigns-tile zone); it is resolved on the build branch now: keep the build branch's version.
- **M4.4b** changed the device heartbeat on `/v1`: it must stay additive (oasdiff).
- Several builders generated migrations off the same base: renumber them all on the chain.

## Merge procedure
Follow the "Merge procedure (house rules)" section of `docs/agent-briefs/merge-3e.md` exactly:
- renumber migrations on the chain so that `db:generate` shows no changes
- hand-written blocks verbatim
- NOT VALID + VALIDATE
- three-way message union in all 13 locales
- impersonation, canary, fixture and freeze-mode wiring (every new tenant table has rows for both orgs in `createOrgFixture`; every text/jsonb column declared in `private-columns.ts`)
- route ownership for every new public route (guest website, gallery, guest hub, seat finder, kiosk and TV board, giving screen, QR-to-give, CFP portal, attendee directory and chat)
- `/v1` additive (oasdiff); Spectral clean; SDK regenerated once at the end
- the lockfile regenerated with pnpm only

Shared modules (the builders appended in parallel; keep one coherent version and say which):
- `guests` and `seating`: M4.3a, M4.3b, M4.4a, M4.4b, M4.7a
- `donations` and `payments`: M4.8c, M4.8d, M4.8e, M4.8f
- `checkin`: M4.4b, M5.6a, M4.8e
- `program`, `registration` and `engagement`: M5.3b, M5.6a, M5.7b, M5.8a, M5.8b
- `command-center`: M5.9a (and any tiles from M4.x)

## Design v2
Every builder in this batch started on design v2. Check the new screens use the v2 components and patterns and pass the check-modules design-tokens gate; run `expectAccessible` in both modes on the new screens. Keep every e2e assertion.

## Money and privacy rules to verify
- Fake payment provider only; `PAYMENTS_PROVIDER` stays fake; integer minor units; Idempotency-Key on every side effect; no `reverse_transfer` on separate charges & transfers.
- Guest photos, networking profiles, chat, leads and seat-finder data are personal: tenant-scoped, opt-in where the briefs say so, allowlisted serializers; the leak canary covers every new serializer and public page.

## Environment and gate
As in `merge-3e.md`:
- environment setup steps 1–5
- the "Don't stall" rules in `common.md` (typecheck with `--concurrency=2`, e2e with `--workers=2`, never end a turn with a background job running)
- `pnpm verify`
- `db:generate` shows no changes
- `contracts:check`
- the WHOLE web e2e suite on a fresh DB (3 projects, 2 workers, headless shell), then the admin suite

Never weaken, skip or delete a test.

## Report (final commit message)
- branches merged
- migrations renumbered (old → new) and every hand-written edit
- conflicts and resolutions (which version of shared code you kept)
- design v2 adoption per branch
- wiring and fixes
- gate numbers (unit/int/e2e web/admin, contracts)
- owner items left open (point to `docs/owner-inbox.md`)
- anything flaky, with exact errors

Then stop.
