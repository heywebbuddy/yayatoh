# M6.X — Phase 6 hardening

Bug fixes and tests only (no features). Fakes only: no live keys, vendor accounts or network calls.

## What was built
- **Journeys** (`apps/web/e2e/p6-journeys-{a,b,c}.spec.ts`): one per track, each chaining the track's real flows, with a keyboard-only segment, axe in both themes and an Arabic RTL render, on all three viewports. A: CRM, API, integrations. B: billing, agency, virtual. C: seating, AI, marketplace.
- **k6** (`k6/api-limits.js`, `sync-throughput.js`, `warehouse-ingest.js`; README): `/v1` limits per entitlement, sync throughput, warehouse ingest. Dev-only tooling: `/api/dev/integrations/load`, `start=1` on `/api/dev/analytics/backfill`, API keys in `load:prepare`.
- **Security review** (`docs/ops/security-review-phase6.md`): OAuth token handling and SSO/SCIM.
- **Leak coverage:** `integrations/tests/connector-payloads.test.ts` pins what each connector may send (documented set); the canary crawl and isolation suites already cover every new table (private-columns coverage test, `createOrgFixture`).
- **Docs:** `docs/runbooks/connectors.md` (switch on/off, what leaves).

## Fixes (tests first)
- Nango proxy paths cannot leave `/proxy` (`providerPath`).
- Slack `no_permission` no longer revokes the connection.
- Contact timeline rows used `bg-white` (dark-mode contrast failure found by the CRM journey).

## Not yet
Zoom webinar-id squatting (F1) and a retried provider revoke on disconnect (F2): owner decisions, see the review. The virtual journey's CE part uses the CE dev conference (watch-time conference is still running).

## Acceptance
| Criterion | Where |
|---|---|
| One journey per track; keyboard only, axe both themes, RTL | `p6-journeys-a/b/c.spec.ts` |
| k6 gates | `k6/*.js` (numbers in the report commit) |
| Security review written | `docs/ops/security-review-phase6.md` |
| No connector payload carries PII beyond its documented set | `connector-payloads.test.ts` |
| Every new tenant table has fixtures for both orgs | isolation suite (`pnpm test:isolation`) |
