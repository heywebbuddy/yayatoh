You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3k: the last Phase 4/5 builders and Phase 6 Wave 2, merged on top of batches 3i and 3j. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
You start on the build branch `m0.5-foundation-ey5gqp`. It carries batches 3c–3i **and design v2**. Batch 3j (`origin/merge/next-3j`) has not landed yet: per `docs/agent-briefs/e2e-sharding.md` ("Running ahead"), you start on top of it.
- `git fetch origin && git checkout -B merge/next-3k origin/m0.5-foundation-ey5gqp && git merge --no-edit origin/merge/next-3j`. 3j was built before 3i landed: renumber 3j's migrations after 3i's last (0122), keep both batches' code (union), and fix the wiring the two batches need together. Note what you did for 3j in your report under "3j on 3i".
- Publish with a normal push: `git push -u origin merge/next-3k`. Never push to any other branch except the `e2e-ready/3k` ref (see below). Never force-push. Never open PRs.
- Every couple of hours, and **before your final gate**, fetch and merge the latest `origin/m0.5-foundation-ey5gqp` and `origin/merge/next-3j` again (3j's session is still finishing; take its newest head).
- **UX track:** U1 (new form controls and a `no-native-select` gate) and U2 (grouped nav) are in `origin/merge/next-3u`, not landed yet. If they land before your final gate, convert every native `<select>` and date/time input your branches add to the U1 components and place every new page in U2's nav groups.
- **Whole e2e:** run it sharded, exactly as `docs/agent-briefs/e2e-sharding.md` says (ready ref `e2e-ready/3k`).

## Merge these branches, one at a time, in this order, with merge commits
The orchestrator lists the final set in your launch prompt (only builders that reported). Expected:
1. `origin/agent/m4.6a`: social Command Center pack (command-center, guests)
2. `origin/agent/m4.8g`: last donations increment (donations reports, reconciliation, CRM layouts)
3. `origin/agent/m5.5c`: kiosk self-print (Scan PWA, badges, printing)
4. `origin/agent/m5.6b`: lead retrieval (leads module)
5. `origin/agent/m5.10a`: attendee conference hub
6. `origin/agent/m6.6b`: meters and plan changes, dormant (billing; **payments**)
7. `origin/agent/m6.7a`: agency v1 (**tenancy**: org access grants, agency module)
8. `origin/agent/m6.12a`: seating rules and solver
9. `origin/agent/m6.2b`: attribution, explorer, scheduled reports (analytics; stacked on M6.2a from 3i)

Each branch's last commit message is its report: read it before merging.

**Known issues (fix, never skip):**
- M6.7a is the highest-risk tenancy change so far: re-run and extend the isolation suite over every money table and every agency query; cross-org reads only through SECURITY DEFINER functions; grants revoked take effect on the next request.
- M4.8g relaxed a `recon_items` check "for the canary seeder": confirm the constraint still forbids every invalid state and the canary is not weakened; prefer fixing the seeder.
- Renumber all migrations on the chain (several builders generated 0113–0116 off the same base).

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

Shared modules (keep one coherent version and say which):
- `command-center`: M4.6a, plus 3i/3j tiles
- `billing` and entitlements: M6.6b (and M6.6a from 3i), M6.7a (`agency`)
- `analytics` and `alerts`: M6.2b
- `seating`: M6.12a, plus 3i (M6.11a/b) and 3j (M4.3a/b)
- `checkin`, `badges`, `engagement`: M5.5c, M5.6b, M5.10a

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
- the WHOLE web e2e suite on a fresh DB (3 projects, 2 workers, headless shell), sharded 3 ways per `e2e-sharding.md`, then the admin suite

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
