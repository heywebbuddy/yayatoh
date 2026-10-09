You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3c. Nobody is watching live: work autonomously to completion; never wait for input; never end your turn while work is unfinished. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
Start from `m0.5-foundation-ey5gqp` (head 5ac4d03 or later). The remote `merge/next` currently points at an ancestor of it, so: `git checkout -B merge/next origin/m0.5-foundation-ey5gqp`, work there, and publish with a **normal fast-forward push** `git push -u origin merge/next` (never `-f`; if the push is rejected, fetch and merge `origin/merge/next` into yours, then push normally). Never push to any other branch, never open PRs. Use the commit attribution your system prompt gives. Your final commit's message is your full report.

## Merge these branches, one at a time, in this order, with merge commits
1. origin/agent/m3.11a — self-serve signup (switched off), pricing page, onboarding checklist
2. origin/agent/m3.11b — help center, marketing pages, status page, on-call runbook
3. origin/agent/m4.1a — guests module: parties and guests (Phase 4)
4. origin/agent/m4.2a — social workspace: co-host/planner event roles, vocabulary, wedding/gala templates
5. origin/agent/m2.4a — front door: legacy/new coexistence, route ownership, proxy (ADR 0020)
6. origin/agent/m2.5a — cutover tooling, freeze mode, reverse ETL, rehearsals
Each branch's last commit message is its report (migrations, hand edits, owner items): read it before merging. The branches are behind the base (which now has batch 3b: metrics, realtime, click tracking, messaging rules v2, audiences, refund ops, waitlists), so expect conflicts. Owner items the branches logged are defaults under the owner's standing "go with all your recommendations"; keep them in docs/owner-inbox.md.

## Merge procedure (house rules; CLAUDE.md applies)
- **Migrations**: the base has migrations up to `0075_*`. Renumber each branch's migrations after the current highest (0076, …) in merge order; fix `packages/db/drizzle/meta/_journal.json` and regenerate the snapshots on the chain so that `pnpm db:generate` afterwards shows **no changes**. Keep every `-- hand-written: begin/end` block verbatim unless a merge edit is needed; list every such edit. CHECKs/FKs on existing tables stay NOT VALID + VALIDATE.
- **Messages**: three-way key union across all 13 locales in `apps/web/messages/*.json` (and admin/notification catalogs), edit JSON by script (ensure_ascii=False, indent=2, trailing newline).
- **Wiring**: impersonation categories for every new command (registry test), canary registry `private-columns.ts` for every new text/jsonb/text[] column, org gate on new org pages, fixture rows for both orgs in `createOrgFixture` for every new tenant table (isolation suite), module tiers and public exports (check:modules). Map M4.1a's guests permissions onto M4.2a's co-host/planner event roles (co-host full event access; planner guests/RSVP/seating/day-of, no payouts/refunds/finance). Make M2.5a's read-only freeze mode cover every new command from all branches in this batch and batch 3b. Make M2.4a's route-ownership table include the new public pages (pricing, help center, status, marketing pages).
- **/v1**: additive only; Spectral clean; regenerate `apps/api/openapi.json` and the SDK; `pnpm contracts:check`.
- **pnpm-lock** regenerated with pnpm, never by hand. `.gitleaksignore` entries from branches kept.
- When two branches implement the same thing differently, keep one coherent version and say which.
- Never weaken, skip or delete a test or gate to get green. Fix interaction failures honestly (product code or test data setup) and explain.

## Environment setup
1. `node --version` v24, `pnpm --version` 12.x, else `bash .claude/cloud-setup.sh`.
2. If `docker ps` fails: `(dockerd > /tmp/dockerd.log 2>&1 &)`, wait, then `docker compose up -d postgres gotenberg mailpit`.
3. Create `/tmp/devenv.sh` exactly as described in `docs/agent-briefs/common.md` (Environment setup, step 3; never commit it) and source it before pnpm/node. Never set PAYMENTS_PROVIDER=stripe, never call Stripe. Never run `playwright install`.
4. `pnpm install && pnpm db:bootstrap && pnpm db:migrate && pnpm seed && pnpm --filter @yayatoh/worker staff -- --email omar@yayatoh.test --role admin`.
5. `pnpm test:int` recreates `yayatoh_test` with random role passwords → `pnpm db:bootstrap` afterwards before e2e. Build with `pnpm --filter @yayatoh/web build` and `--filter @yayatoh/admin build` (not `pnpm build`); rebuild after changes before e2e.

## Gate (all must pass before the final push)
1. `pnpm verify`, `pnpm db:generate` shows no changes, `pnpm contracts:check`.
2. On a fresh DB: the WHOLE web e2e suite (`cd apps/web && npx playwright test --reporter=line`), then the admin suite. Fix real failures; look for races first (CI runs the three projects in parallel on shared orgs and uses the Chromium headless shell under /opt/pw-browsers/chromium_headless_shell-*); a test may be recorded as flaky only with its exact error after passing 5/5 alone and in the full rerun. Run the new specs of these branches once on the headless shell.
3. Push `merge/next` (normal push).

## Report (final commit message)
Branches merged; migrations renumbered (old → new) and every hand-written edit; conflicts and resolutions; wiring and fixes added; gate numbers (unit/int/e2e web/admin, contracts); owner items left open (point to docs/owner-inbox.md); anything flaky with exact errors. Then stop.
