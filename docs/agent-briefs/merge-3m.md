You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3m: Phase 6 Waves 3 and 4 (AI v2, agency v2 money and operations, Zoom + CE credits, virtual v2, marketplace search, venues) plus any batch-3l stragglers. Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

Read `docs/agent-briefs/e2e-sharding.md` (sharded e2e, running ahead) and `docs/plans/phase-6.md` (rows M6.8–M6.14; decisions P6-1 to P6-13).

## Branch and git
- `git fetch origin && git checkout -B merge/next-3m origin/m0.5-foundation-ey5gqp`, then merge, each only if not already an ancestor: `origin/merge/next-3l` (which carries 3k and 3u) and then `origin/merge/next-3v` (UX U3–U10 on 3u). None of these may have landed yet; you run ahead on top of them. Where 3l and 3v conflict, keep both behaviours and U1/U2's controls and navigation.
- Publish with a normal push: `git push -u origin merge/next-3m`. Never push to any other branch except the `e2e-ready/3m` ref. Never force-push. Never open PRs.
- Every couple of hours, and **before your final gate**, fetch and merge the latest `origin/m0.5-foundation-ey5gqp`, `origin/merge/next-3l` and `origin/merge/next-3v`.

## Merge these branches, one at a time, in this order, with merge commits
The orchestrator's launch prompt lists the final set (only builders that reported) and any 3l stragglers. Each branch's last commit message is its report: read it before merging. Stacked branches already contain their parents; merge the parent first anyway so each report's diff stays reviewable.
1. `origin/agent/m6.12b`: AI v2 (drafting with tone and brand kits, audience suggestions; AI port fake)
2. `origin/agent/m6.8a`: agency v2 money (**payments, tenancy**: agency pays for clients, commission as a second transfer)
3. `origin/agent/m6.8b`: agency v2 operations (**tenancy**: templates and brand kits published downward, per-client campaign fan-out)
4. `origin/agent/m6.9b`: Zoom + CE credits (**legal-copy**: certificate wording is placeholder for counsel)
5. `origin/agent/m6.10a`: virtual v2 (Zoom webinars, join/leave webhooks, Cloudflare Stream; stacks on M6.9a/M6.9b)
6. `origin/agent/m6.14a`: marketplace search (SearchIndex port, Meilisearch fake, public read model only)
7. `origin/agent/m6.14b`: venues (**tenancy**: venue portal, shared layouts via `venue_partner` grants; stacks on M6.14a)

## Known issues (fix, never skip)
- **Migrations:** every builder generated off a different base (some after 3u/3v). Renumber all of them on the chain after the newest migration on your base (3l and 3v bring their own); `db:generate` must show no changes; hand-written blocks verbatim.
- **Tenancy** (M6.8a, M6.8b, M6.14b; highest risk): rerun and extend the isolation suite over every new table and every cross-org read; cross-org reads only through SECURITY DEFINER functions granted in a migration, returning allowlisted columns; a revoked agency or venue grant takes effect on the next request; SSO sessions (M6.5a, from 3l) open only their org on every new page.
- **Payments** (M6.8a): fake provider only; `PAYMENTS_PROVIDER` stays fake; integer minor units; Idempotency-Key on every side effect; commission is a second transfer in the same transfer group for `platform_mor`; refunds reverse with explicit transfer reversals (never `reverse_transfer` on separate charges & transfers).
- **Stacking:** M6.9a (3l) → M6.9b → M6.10a share the virtual module and the Zoom connector; M6.14a → M6.14b share search. Keep one coherent version of each and say which.
- **Webhooks:** Zoom join/leave webhooks verified on the raw body and deduplicated by provider event id; every new outbox event classified in `catalog.ts` or `internal-events.ts`.
- **Privacy:** every new table with personal data has a `DataSubjectContributor`, a planter line and `private-columns.ts` entries; search documents carry only public read-model fields (D13: weddings/private events never public).
- Every native `<select>`/date input goes to U1's components; every new page sits in U2's nav groups with the right permission/entitlement gating; `pnpm check:modules` (incl. `no-native-select`) green across the tree.
- No real vendor accounts, keys or network calls (AI, Zoom, Cloudflare, Meilisearch, Mux all fake); `.env.example` names only.

## Merge procedure, environment and gate
As in `merge-3e.md` (house rules: messages union in all 13 locales, lockfile with pnpm only, `/v1` additive, Spectral clean, SDK regenerated once at the end, fixture rows for both orgs on every new tenant table, route ownership for new public routes such as venue and search pages; environment steps 1–5; "Don't stall" in `common.md`): `pnpm verify`, `db:generate` clean, `contracts:check`, the WHOLE web e2e suite **sharded per `e2e-sharding.md`** (ready ref `e2e-ready/3m`), then the admin suite. Never weaken, skip or delete a test.

## Report (final commit message)
- branches merged (and the 3l/3v heads you merged)
- migrations renumbered (old → new)
- conflicts and resolutions (which version of shared code you kept: virtual, search, agency, billing)
- tenancy and payments checks added or extended
- gate numbers (unit/int, e2e per shard with the SHA, admin, check-modules, contracts)
- labels needing owner approval (payments, tenancy, legal-copy, db-migration) and owner items (point to `docs/owner-inbox.md`)
- anything flaky, with exact errors

Then stop.
