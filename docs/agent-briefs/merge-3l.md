You are the merge session for **Yayatoh 2.0** (repo heywebbuddy/yayatoh), batch 3l: Phase 6 Wave 2b (integrations M6.4b–d and M6.5b–d, SSO/SCIM M6.5a, virtual v1 M6.9a). Nobody is watching live: work autonomously to completion and never wait for input. The orchestrator lands your result on the build branch after reading your report.

Read `docs/agent-briefs/e2e-sharding.md` (sharded e2e, running ahead) and `docs/plans/phase-6.md` (rows M6.4–M6.5, M6.9A; decisions P6-1 to P6-13).

## Branch and git
- `git fetch origin && git checkout -B merge/next-3l origin/m0.5-foundation-ey5gqp && git merge --no-edit origin/merge/next-3k`. Batch 3k (3j + Phase 4/5 tail + Phase 6 Wave 2) has not landed yet; you run ahead on top of it. Then merge `origin/merge/next-3u` (U1 form controls + U2 nav; not landed either) if it is not already an ancestor.
- Publish with a normal push: `git push -u origin merge/next-3l`. Never push to any other branch except the `e2e-ready/3l` ref. Never force-push. Never open PRs.
- Every couple of hours, and **before your final gate**, fetch and merge the latest `origin/m0.5-foundation-ey5gqp`, `origin/merge/next-3k` and `origin/merge/next-3u`.

## Merge these branches, one at a time, in this order, with merge commits
The orchestrator's launch prompt lists the final set (only builders that reported). Each branch's last commit message is its report: read it before merging.
1. `origin/agent/m6.4b`: HubSpot (integrations framework changes: connector meta, `local`, pull WriteMeta, loadScope)
2. `origin/agent/m6.4c`: Zapier + Slack
3. `origin/agent/m6.4d`: Mailchimp (audience sync, consent history)
4. `origin/agent/m6.5b`: Salesforce (carries M6.4b's framework hunks verbatim: keep one copy)
5. `origin/agent/m6.5c`: Calendar, Make, n8n
6. `origin/agent/m6.5d`: accounting (QuickBooks Online, Xero; **money**)
7. `origin/agent/m6.5a`: SSO (SAML/OIDC) and SCIM (**auth, tenancy, db-migration**: owner approval before main)
8. `origin/agent/m6.9a`: virtual v1 (Mux fake, watch time, virtual checkpoint)

## Known issues (fix, never skip)
- **Migrations:** every builder generated its migration off the same base (M6.4c `0123_workable_miracleman.sql`, and others). Renumber all of them on the chain after the newest migration on your base (3k and 3u bring their own); `db:generate` must show no changes.
- **Integrations framework:** M6.4b, M6.5b and M6.4d each touched `engine.ts`, `sdk/connector.ts`, `connectors/index.ts`, the mapping form and the dev fake route. Keep one coherent framework with every connector registered; the integrations e2e (`integrations.spec.ts`) must find each connector's card by its own name.
- **Left open by 3i:** every connector that stores personal data (HubSpot, Salesforce, Mailchimp, Zapier/Slack/Make/n8n payload logs, accounting contacts) has an erasure hook in its `DataSubjectContributor` (erasure removes or unlinks remote links per the brief; never calls a real API: fakes in tests). Subscribe the alert engine to the new integrations failure events and the billing/virtual events the reports list (`alerts` module), with tests.
- **SSO** (highest risk in the batch): rerun `sso.int.test.ts`, `sso-staff.int.test.ts` and the isolation suite after the merge; an SSO session opens only its org on every route 3k/3u added (command center widgets, new console pages, realtime channels). Platform staff never skip TOTP.
- **Virtual:** `virtual.attended@1` stays in `INTERNAL_EVENTS` ('personal'); in-person-only tickets never stream.
- Every native `<select>`/date input these branches add goes to U1's components; every new page sits in U2's nav groups with the right permission/entitlement gating. `pnpm check:modules` (incl. `no-native-select`) green across the tree.
- Fake providers only (Nango fake, fake Mux, fake IdP, fake DNS, fake payments); no real accounts, keys or network calls; `PAYMENTS_PROVIDER` stays fake; money in integer minor units.

## Merge procedure, environment and gate
As in `merge-3e.md` (house rules: messages union in all 13 locales, lockfile with pnpm only, `/v1` additive, Spectral clean, SDK regenerated once at the end, fixture rows for both orgs on every new tenant table, `private-columns.ts`, DSAR contributors and planter lines, route ownership for new public routes such as `/sso/*`, `/api/scim/v2`, watch pages; environment steps 1–5; "Don't stall" in `common.md`): `pnpm verify`, `db:generate` clean, `contracts:check`, the WHOLE web e2e suite **sharded per `e2e-sharding.md`** (ready ref `e2e-ready/3l`), then the admin suite. Never weaken, skip or delete a test.

## Report (final commit message)
- branches merged (and the 3k/3u heads you merged)
- migrations renumbered (old → new)
- conflicts and resolutions (which version of the integrations framework you kept)
- erasure hooks and alert subscriptions added
- gate numbers (unit/int, e2e per shard with the SHA, admin, check-modules, contracts)
- labels needing owner approval (auth, tenancy, payments, db-migration) and owner items (point to `docs/owner-inbox.md`)
- anything flaky, with exact errors

Then stop.
