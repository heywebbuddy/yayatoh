You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3i: the **Phase 6 Wave 1** builders, merged on top of batch 3h and design system v2. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

## Branch and git
You start on the build branch `m0.5-foundation-ey5gqp`. By the time you run, it carries batches 3c–3h **and design v2**.
- If `git merge-base --is-ancestor origin/merge/next-3h origin/m0.5-foundation-ey5gqp` fails, stop and report: batch 3h must land first.
- `git fetch origin && git checkout -B merge/next-3i origin/m0.5-foundation-ey5gqp`
- Publish with a normal push: `git push -u origin merge/next-3i`. Never push to any other branch. Never force-push. Never open PRs.
- Before your final gate, fetch and merge the latest `origin/m0.5-foundation-ey5gqp` again.

## Merge these branches, one at a time, in this order, with merge commits
The orchestrator lists the final set in your launch prompt (only builders that reported). The expected order:
1. `origin/agent/m6.1a`: CRM merge/dedupe and the person timeline (crm)
2. `origin/agent/m6.1b`: contact stats, RFM, no-show propensity (crm, audiences segment DSL)
3. `origin/agent/m6.1c`: DSAR propagation (every module's data-subject contributor; it already merged m6.1a/m6.1b)
4. `origin/agent/m6.3a`: API keys, usage, sandbox orgs (api-v1, tenancy)
5. `origin/agent/m6.3b`: webhooks GA, event catalog, docs and SDK pipeline (stacked on m6.3a)
6. `origin/agent/m6.6a`: billing foundation, dormant (billing tier 1, entitlements)
7. `origin/agent/m6.11a`: best-available and the ADA engine (seating, ticketing)
8. `origin/agent/m6.11b`: seat channels, layout revisions, the layout library (stacked on m6.11a)
9. `origin/agent/m6.2a`: analytics warehouse (Postgres rollups default, Tinybird adapter as a fake), cross-event dashboards (new `analytics` module)
10. `origin/agent/m6.4a`: integrations framework (Nango port as a fake, connections, mappings, sync engine, errors inbox; new `integrations` module)

Each branch's last commit message is its report (migrations, hand edits, owner items): read it before merging. A branch without a report is not in your list. Stacked branches already contain their base; merge the base first anyway so conflicts are resolved once.

**Known issues from the builders' reports (fix, never skip):**
- M6.1c: after merging design v2, two e2e tests (including "Arabic (RTL): duplicates") fail on desktop-1280 only, because the v2 Table's sticky `<thead>` intercepts the click. Fix the table (pointer events / scroll margin) or the page, not the test.
- M6.11b: its full integration run caught `seating.deleteChannel` missing from the impersonation sweep; confirm the fix is in and the sweep covers every new seating command.
- The retention.int and badges.int full-suite timeouts should be gone after 3f and 3h; if either reappears, root-cause it.

**Parallel batch:** batch 3j (Phase 4/5) runs at the same time on the same base. Whichever of you finishes second must merge the newest build branch (with the other batch landed), renumber migrations on top of it and rerun the gate. Say in your report whether 3j had landed.

## Merge procedure
Follow the "Merge procedure (house rules)" section of `docs/agent-briefs/merge-3e.md` exactly:
- renumber migrations on the chain so that `db:generate` shows no changes
- hand-written blocks verbatim
- NOT VALID + VALIDATE
- three-way message union in all 13 locales
- impersonation, canary, fixture and freeze-mode wiring (every new tenant table has rows for both orgs in `createOrgFixture`; every text/jsonb column declared in `private-columns.ts`)
- route ownership for every new public route
- `/v1` additive (oasdiff); Spectral clean; SDK regenerated once at the end
- the lockfile regenerated with pnpm only

Shared code (the builders appended in parallel; keep one coherent version and say which):
- `crm`: M6.1a, M6.1b, M6.1c (the DSAR contributor registry must list every module, including the new seating, billing and api-key tables)
- `api-v1` and `openapi.json`: M6.3a, M6.3b, plus any `/v1` additions from M6.1x
- `billing` and entitlement keys: M6.6a, M6.3a (rate limits per entitlement), M6.11a (`advanced_seating`)
- `seating` and `ticketing`: M6.11a, M6.11b
- `analytics` (M6.2a) and `integrations` (M6.4a): new modules; check their tiers, the DSAR contributor list and the leak canary

## Design v2
Every builder in this batch merged `agent/design-v2` only if it applied cleanly; several did not. After each merge, make the branch's screens use the v2 components and patterns (PageHeader, Tabs, StatusPill, EmptyState, Skeleton, Toast, Table, form patterns, shells) and pass the check-modules design-tokens gate. Run `expectAccessible` in both modes on the new screens. Keep every e2e assertion (switch selectors to roles or labels where a class changed).

## Phase 6 rules to verify
- Every Phase 6 capability is behind its flag and entitlement key (P6-13).
- No real third-party calls, keys or accounts: Stripe, Svix, Tinybird and npm publishing go through ports with fakes; `PAYMENTS_PROVIDER` stays fake.
- Isolation suite covers every new table; the leak canary covers every new serializer and webhook payload.

## Environment and gate
As in `merge-3e.md`:
- environment setup steps 1–5
- the "Don't stall" rules in `common.md` (typecheck with `--concurrency=2`, e2e with `--workers=2`, never end a turn with a background job running)
- `pnpm verify`
- `db:generate` shows no changes
- `contracts:check`
- the WHOLE web e2e suite on a fresh DB (3 projects, 2 workers, headless shell), then the admin suite

Never weaken, skip or delete a test. A test that fails only in the full suite has a root cause (shared state, ordering, time); find and fix it.

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
