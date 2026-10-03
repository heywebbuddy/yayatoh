You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3u: the first UX-track batch, **U1 (form controls) then U2 (grouped navigation)**. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

## Why this batch is small and goes first
U1 replaces every native `<select>` and date/time input and adds the check-modules `no-native-select` gate. U2 regroups the console navigation. Every other UX branch (U3–U10) stacks on U1 (U5 and U10 on U2 too), so this batch lands before the rest of the UX track is merged. Read `docs/plans/ux-review-1.md` (approved; section 3 principles, rows U1 and U2).

## Branch and git
- `git fetch origin && git checkout -B merge/next-3u origin/m0.5-foundation-ey5gqp`
- U1 and U2 were built on the build branch **plus** merge batches 3i and 3j, which may not have landed yet. So first merge `origin/merge/next-3i`, then `origin/merge/next-3j` (each that is not already an ancestor), exactly as they are: don't fix their code here beyond what U1/U2 need. The orchestrator lands this batch only **after** 3i and 3j have landed.
- Publish with a normal push: `git push -u origin merge/next-3u`. Never push to any other branch. Never force-push. Never open PRs.
- Every couple of hours, and **before your final gate**, fetch and merge the latest `origin/m0.5-foundation-ey5gqp`, `origin/merge/next-3i` and `origin/merge/next-3j` again.

## Merge these branches, one at a time, in this order, with merge commits
1. `origin/agent/u1`: form controls (Select, Combobox, date/time/time-zone/currency pickers), ~160 native selects and ~40 date inputs replaced, the `no-native-select` gate and canary, e2e helpers (`pickOption` etc.).
2. `origin/agent/u2`: grouped collapsible org sidebar, global Create menu, help entry and "How it works" panels, empty states.

Each branch's last commit message is its report: read it before merging.

## What to verify (fix, never skip)
- **The gate covers the whole tree.** `pnpm check:modules` must be green with `no-native-select` across everything now on the branch, including code 3i and 3j brought in after U1 was built. Convert any remaining native `<select>` or date/time input to U1's components (never allowlist it). Run the gate's canary.
- **The chevron** (owner's complaint): spot-check the U1 geometry tests and visual baselines pass at 3 widths, LTR and RTL, light and dark.
- **Navigation:** every page 3i/3j added appears in U2's nav groups with the right permission/module gating; nothing lost from the old sidebar. Door/scanner and viewer roles see only what U2's report says.
- **E2E:** U1 moved specs to role/label selectors and `pickOption`-style helpers without dropping assertions. Specs that 3i/3j added and still drive native selects must move to the helpers too; keep every assertion.
- 13 locales (three-way message union; Arabic RTL), design tokens only, logical CSS, 24 px targets.

## Merge procedure
Follow the "Merge procedure (house rules)" section of `docs/agent-briefs/merge-3e.md` (messages union in all 13 locales, lockfile regenerated with pnpm only, `/v1` additive, SDK regenerated once at the end if `/v1` changed, `db:generate` shows no changes).

## Environment and gate
As in `merge-3e.md`:
- environment setup steps 1–5
- the "Don't stall" rules in `common.md` (typecheck with `--concurrency=2`, e2e with `--workers=2`, never end a turn with a background job running)
- `pnpm verify`
- `db:generate` shows no changes
- `contracts:check`
- the WHOLE web e2e suite on a fresh DB (3 projects, 2 workers, headless shell), then the admin suite

Never weaken, skip or delete a test.

## Screenshots
Commit after-merge screenshots of the org console (sidebar groups open/closed, Create menu, a long Select open with search, a date picker open), light and dark, 1280 and 390 px, LTR and Arabic, under `docs/ux/screenshots/merge-3u/` with a short README.

## Report (final commit message)
- branches merged (with the 3i/3j heads you merged)
- conflicts and resolutions
- native selects/date inputs converted after the merge (file list)
- pages placed in nav groups
- gate numbers (unit/int/e2e web/admin, check-modules incl. canary, contracts)
- owner items left open (point to `docs/owner-inbox.md`: U1's four defaults, U2's items)
- anything flaky, with exact errors

Then stop.
