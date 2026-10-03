You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3v: the rest of the UX track, **U3–U10**, on top of batch 3u (U1 form controls + U2 navigation). Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

Read `docs/plans/ux-review-1.md` (approved; section 3 principles and rows U3–U10) and `docs/agent-briefs/e2e-sharding.md` (sharded e2e, running ahead).

## Branch and git
- `git fetch origin && git checkout -B merge/next-3v origin/m0.5-foundation-ey5gqp && git merge --no-edit origin/merge/next-3u`. 3u has not landed yet (it is finishing its gate); you run ahead on top of it.
- Publish with a normal push: `git push -u origin merge/next-3v`. Never push to any other branch except the `e2e-ready/3v` ref. Never force-push. Never open PRs.
- Every couple of hours, and **before your final gate**, fetch and merge the latest `origin/m0.5-foundation-ey5gqp` and `origin/merge/next-3u` (and `origin/merge/next-3k` if it has landed on the build branch by then).

## Merge these branches, one at a time, in this order, with merge commits
Each branch's last commit message is its report: read it before merging.
1. `origin/agent/u3`: review bugs (blog link per host, domain step-up and connect wizard, venue photos on create)
2. `origin/agent/u4`: Command Center v2 (hero strip, KPI row, dense grid, real alerts)
3. `origin/agent/u5`: Money dashboards (finance overview, payouts timeline and drill-down, fees; read-only; **payments data**)
4. `origin/agent/u6`: templates from scratch (sections, checklist)
5. `origin/agent/u7`: series ↔ events
6. `origin/agent/u8`: org categories, tags, event-type picker
7. `origin/agent/u9`: org-wide coupons and currencies (**payments**: pricing at checkout)
8. `origin/agent/u10`: media library, storage page, sending identity, org contact form. Merge it only when its last commit is its report (the subject says "report"); if it isn't by the time everything else is green, poll every 10 minutes for up to 2 hours, then report without it and say so.

## Known issues (fix, never skip)
- **Migrations:** U4 (via M4.6a: `0123_social_guest_pack.sql`), U6 (`0123_massive_tusk.sql`), U9 (`0123_wide_punisher.sql`) and possibly U10 all generated 0123 off the same base. Renumber them on the chain after the newest migration on your base; `db:generate` must show no changes.
- **U7** left an ~80-file conflict with batch 3j to the merge, and listed 5 blockers in its report: resolve each (keep both sides' behaviour) and say how.
- **U1 Combobox render loop:** U9 fixed one; U7 reported one. Make sure the single fix in `packages/ui` covers both cases (add a unit test that would loop without it).
- Every native `<select>`/date input these branches add goes to U1's components; every new page sits in U2's nav groups with the right permission/module gating. `pnpm check:modules` (incl. `no-native-select`) must be green across the whole tree.
- Fake payment provider only; money in integer minor units; the door role never sees revenue (U4, U5).

## Merge procedure, environment and gate
As in `merge-3e.md` (house rules; environment steps 1–5; "Don't stall" in `common.md`): `pnpm verify`, `db:generate` clean, `contracts:check`, the WHOLE web e2e suite **sharded per `e2e-sharding.md`** (ready ref `e2e-ready/3v`), then the admin suite. Never weaken, skip or delete a test; keep every assertion (move selectors to roles/labels where markup changed).

## Screenshots
Each builder committed before/after screenshots under `docs/ux/screenshots/<u>/`. Keep them; add a short `docs/ux/screenshots/merge-3v/README.md` listing anything that looks different after the merge, with a fresh capture of those pages.

## Report (final commit message)
- branches merged (and the 3u head you merged)
- migrations renumbered (old → new)
- conflicts and resolutions (U7's 5 blockers one by one)
- gate numbers (unit/int, e2e per shard with the SHA, admin, check-modules, contracts)
- owner items left open (point to `docs/owner-inbox.md`)
- anything flaky, with exact errors

Then stop.
