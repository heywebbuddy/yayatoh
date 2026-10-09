You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3d. Nobody is watching live: work autonomously to completion; never wait for input; never end your turn while work is unfinished. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
Start from `m0.5-foundation-ey5gqp` (latest head). The remote `merge/next` currently points at an ancestor of it, so: `git checkout -B merge/next origin/m0.5-foundation-ey5gqp`, work there, and publish with a **normal fast-forward push** `git push -u origin merge/next` (never `-f`; if the push is rejected, fetch and merge `origin/merge/next` into yours, then push normally). Never push to any other branch, never open PRs. Use the commit attribution your system prompt gives. Your final commit's message is your full report.

## Merge these branches, one at a time, in this order, with merge commits
1. origin/agent/m3.2a — Command Center shell: widget registry, role layouts, event modes, readiness score
2. origin/agent/m3.2b — alert engine: states, grouping, rules, routing, exact fixture alerts
3. origin/agent/m3.4a — staff mode in the Scan PWA: live counts, device board, alerts, kiosk/supervisor
4. origin/agent/m3.5b — provider adapters: SES, Twilio, WhatsApp (Cloud API + gateway), fallback chains
Each branch's last commit message is its report (migrations, hand edits, owner items): read it before merging. If a branch has no report commit (the session stopped early), run its own spec's tests and gate as part of yours and list what you had to finish. The branches are behind the base (which now has batch 3c: signup, help/status, guests, social workspace roles, front door, cutover tooling), so expect conflicts. Owner items the branches logged are defaults under the owner's standing "go with all your recommendations"; keep them in docs/owner-inbox.md.

## Merge procedure (house rules; CLAUDE.md applies)
- **Migrations**: the base's highest migration number is in `packages/db/drizzle/meta/_journal.json`. Renumber each branch's migrations after the current highest  in merge order; fix `packages/db/drizzle/meta/_journal.json` and regenerate the snapshots on the chain so that `pnpm db:generate` afterwards shows **no changes**. Keep every `-- hand-written: begin/end` block verbatim unless a merge edit is needed; list every such edit. CHECKs/FKs on existing tables stay NOT VALID + VALIDATE.
- **Messages**: three-way key union across all 13 locales in `apps/web/messages/*.json` (and admin/notification catalogs), edit JSON by script (ensure_ascii=False, indent=2, trailing newline).
- **Wiring**: impersonation categories for every new command (registry test), canary registry `private-columns.ts` for every new text/jsonb/text[] column, org gate on new org pages, fixture rows for both orgs in `createOrgFixture` for every new tenant table (isolation suite), module tiers and public exports (check:modules). Register M3.2b's alerts widget and M3.4a's staff views in M3.2a's widget registry with the right role visibility (the door layout shows no revenue). Wire M3.2b's deliverability rule to M3.5b's provider webhooks. Make M2.5a's read-only freeze mode cover every new command in this batch. Make M2.4a's route-ownership table include any new public routes (provider webhooks).
- **/v1**: additive only; Spectral clean; regenerate `apps/api/openapi.json` and the SDK; `pnpm contracts:check`.
- **pnpm-lock** regenerated with pnpm, never by hand. `.gitleaksignore` entries from branches kept.
- When two branches implement the same thing differently, keep one coherent version and say which.
- Never weaken, skip or delete a test or gate to get green. Fix interaction failures honestly (product code or test data setup) and explain.

## Known intermittent failure to root-cause in this batch
CI run 36573133566 (head f4e4fcc, docs-only commit), shard 2/6: `[mobile-375] e2e/realtime.spec.ts:244 "a dropped connection resumes from its last message and misses nothing"` failed with `apiRequestContext.post: read ECONNRESET` on `POST /api/dev/seat-streams` (line 256). It passed on runs 101, 102 and 104. `dropRealtimeStreams()` (apps/web/src/server/realtime.ts) closes every open stream of the process, so the three projects running in parallel drop each other's streams, and the reset may hit the POST's own keep-alive socket. Find the real cause (product or test data setup), fix it properly (for example scope the dev drop to the caller's streams or org, or make the request robust in a way that still proves the resume), prove it with `--repeat-each=5` on all three projects on the headless shell, and list it in your report. Never weaken or skip the test.

Second intermittent failure: CI run 36574854587 (head f9d7f42, docs-only), shard 6/6: `[desktop-1280] e2e/seat-finder.spec.ts:392 "instant name lookup: the organizer opts in; exact names only; past the limit a challenge; viewers cannot change it"` hit the 120 s test timeout at line 443 (`challenge.getByLabel("I'm a person (test check)").check()`). The challenge group was visible but the fake checkbox was never found. Download the run's e2e-report-6 artifact trace if you can, then decide whether the checkbox is missing from the render (for example the widget re-rendered without the fake input, or the provider resolved differently) or the 30–70 sequential lookups before it simply ran out of time under CI load. Fix the real cause (product, or making the test reach the challenge faster while still proving the limit), prove it with `--repeat-each=5` on the headless shell, and report it. Never weaken or skip the test.

Third intermittent failure, same family: CI run 36597004367 (head fd94edf, docs-only), shard 3/6: `[tablet-768] e2e/event-content.spec.ts:248` failed with `apiRequestContext.get: read ECONNRESET` on `GET /events/<slug>` (line 284), before any assertion. The web server logged dozens of `⨯ Error: The destination stream closed early.` (digest 868515261) during the run. Treat the three failures as one systemic problem first: find why the `next start` server resets `page.request` connections under the CI load (for example keep-alive socket reuse after a streamed/SSE response is aborted, `dropRealtimeStreams()` destroying shared sockets, server keepAliveTimeout vs the client agent, or memory pressure), fix it at the root, and prove the three tests pass with `--repeat-each=5` on the headless shell with two workers like CI. Only then look at test-specific causes.

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
