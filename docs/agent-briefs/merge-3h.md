You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3h: the Phase 4 Wave B and Phase 5 Wave 2 builders, merged on top of **design system v2**. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
You start on the build branch `m0.5-foundation-ey5gqp`. By the time you run, it carries batches 3c–3g **and design v2** (`agent/design-v2`, landed by the orchestrator).
- If `git merge-base --is-ancestor origin/agent/design-v2 origin/m0.5-foundation-ey5gqp` fails, stop and report: design v2 must land first.
- `git fetch origin && git checkout -B merge/next-3h origin/m0.5-foundation-ey5gqp`
- Publish with a normal push: `git push -u origin merge/next-3h`. Never push to any other branch. Never force-push. Never open PRs.
- Before your final gate, fetch and merge the latest `origin/m0.5-foundation-ey5gqp` again.

## Merge these branches, one at a time, in this order, with merge commits
The orchestrator lists the final set in your launch prompt (only builders that reported). The expected order:
1. `origin/agent/m5.1c`: approvals, groups and +1 (registration)
2. `origin/agent/m5.2b`: atomic enrollment and waitlist (registration, program)
3. `origin/agent/m5.7a`: polls and Q&A (the engagement module)
4. `origin/agent/m4.1d`: RSVP flow (guests)
5. `origin/agent/m4.1e`: RSVP questions (forms, guests)
6. `origin/agent/m4.1f`: invitations and contact collector (guests, messaging, journeys)
7. `origin/agent/m4.2b`: gala tables and sponsors (guests, ticketing, seating)
8. `origin/agent/m4.8a`: donations and giving page (donations, orders, payments)

Each branch's last commit message is its report (migrations, hand edits, owner items): read it before merging. A branch without a report is not in your list.

## Merge procedure
Follow the "Merge procedure (house rules)" section of `docs/agent-briefs/merge-3e.md` exactly:
- renumber migrations on the chain so that `db:generate` shows no changes
- hand-written blocks verbatim
- NOT VALID + VALIDATE
- three-way message union in all 13 locales
- impersonation, canary, fixture and freeze-mode wiring
- route ownership for every new public route (RSVP page and links, the contact collector, the giving page, the claim links, the poll and Q&A participant and big-screen views, group registration pages)
- `/v1` additive; Spectral clean; SDK regenerated
- the lockfile regenerated with pnpm only

Shared modules (the builders appended in parallel; keep one coherent version and say which):
- `guests`: M4.1d, M4.1e, M4.1f, M4.2b
- `registration`: M5.1c, M5.2b
- `program`: M5.2b, M5.7a
- `ticketing` and `orders`: M4.2b, M4.8a
- `forms`: M4.1e

## Design v2 (the main extra job of this batch)
These builders were told to use only existing `@yayatoh/ui` components, and design v2 changed or replaced many of them.
- After each merge, make the branch's screens use the v2 components and patterns: PageHeader, Tabs, StatusPill, EmptyState, Skeleton, Toast, Table, form patterns, the shells.
- Read `docs/adr/0022-*.md`, `packages/ui/README.md` and the living style guide (`/dev/design`).
- Public pages (RSVP, giving, collector, polls) follow the v2 public shell and the light/dark switch.
- No raw colours. Keep every e2e assertion (switch selectors to roles or labels where a class changed); never weaken a test.
- Run `expectAccessible` in both modes on the new screens.

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
