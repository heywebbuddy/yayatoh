# Spec: M6.7 — Agency

- **Milestone:** M6.7 (roadmap Phase 6, "M6.7/6.8 Agency"; Phase 6 plan `docs/plans/phase-6.md`, Wave 2: M6.7a; Wave 3: M6.8a/b)
- **Status:** M6.7a built (2026-10-03); agency v2 (M6.8a money, M6.8b operations) follows in Wave 3
- **Risk tags:** `db-migration`, `tenancy`, `auth` (owner approval)
- **Related:** owner decisions P6-8 (agency v1 now), P6-13 (entitlement key `agency`), D23 (clients pay first); research `docs/research/30-gap-agency-model.md`; M1.2e (impersonation guards, the model for "acting as"), M1.14b (audit view), M3.1a (metric projections), M4.2a (event roles, the permission-ceiling pattern)

## M6.7a — Agency v1 (done)

### 1. Goal and users
Event agencies and planners run events for several clients. A **client** (an ordinary organizer
org) gives an **agency org** access from its own console, choosing what the agency may do and
whether it may read the client's money; the client takes access away at any time. **Agency
members** then switch between their clients from the org switcher, work in each client's console
under a visible "via Agency" badge, and see their whole book on the agency's **Clients | Events |
Marketing | Reports** pages. Clients pay for themselves (D23): no money moves through the agency.

### 2. References
- **Vision §12:** "An event agency may see: Clients | Events | Marketing | Reports".
- **Phase 6 plan:** Wave 2 row M6.7a; P6-8 ("money and billing tables still require direct
  membership unless the client opts in"); P6-13 (`agency` key).
- **Research 30:** client = a full org; access through client-revocable grants, not memberships;
  cross-client reports from snapshots owned by the agency; a RESTRICTIVE policy on money tables.
- **Legacy evidence:** none (Eventmie Pro has no agencies).

### 3. Scope (built)
**Grants (tenancy, tier 1).** `tenancy.org_access_grants`, owned by the **client** (`org_id`):
`agency_org_id`, `role` (a ceiling: `manager`, `marketing` or `viewer`; never owner, admin or
finance), `finance` (the money opt-in, off by default), `granted_by`, `revoked_at`/`revoked_by`.
One live grant per (client, agency); revoked rows stay as history.
- Commands: `tenancy.grantAgencyAccess` (agency address = its slug; `members:manage`, step-up),
  `tenancy.updateAgencyGrant` (role and finance; step-up), `tenancy.revokeAgencyGrant`
  (`members:manage`, **no step-up**: taking access away is one click). Query
  `tenancy.listAgencyGrants` (`members:read`). Events `tenancy.agency_grant_created@1`,
  `…_changed@1`, `…_revoked@1`. Audit actions `agencyGrant.create|update|revoke`.
- **Acting through a grant.** A user with no membership in the org but a live grant (the user is
  a member of the agency, not a collaborator; the agency org is `kind = 'agency'` and active or
  limited) gets the grant's **console role**: `agency_manager`, `agency_marketing` or
  `agency_viewer`, with `_finance` when the client opted in. Its permissions are the granted role's
  minus everything in `AGENCY_NEVER` (platform, payouts, billing, members, API keys, audit,
  privacy, finance, disputes, agency pages, refunds, box-office sales, org settings, attendee
  exports); the finance opt-in adds read-only `finance:read` and `billing:read`. Event roles never
  apply through a grant.
- `Ctx.viaAgency { grantId, agencyOrgId }` (kernel) carries the grant. The org authorizer
  re-reads the live grant on **every** permission check (`tenancy.agency_access()`) and refuses
  unless it matches `ctx.viaAgency` exactly; the console (`loadConsoleBase` through
  `apps/web/src/server/org-actor.ts`) builds the context per request. Nothing is cached, so a
  revoked grant is refused on the next request (a 404 in the console). `proxy.ts` is unchanged:
  the check is in the command/query path.
- **Audit:** every row written under a grant carries `viaAgency: org:<agency id>` and
  `agencyGrantId` in `data` (inside the hash chain), and the Activity view shows both.
- **Money tables.** `withTenant` sets `app.agency_grant_id`; a RESTRICTIVE row policy
  `…_agency_money_guard` on every money table calls `tenancy.money_access_allowed()`: no grant in
  the transaction → allowed (members, buyers, API keys, system actors: unchanged); acting through
  a grant → rows only while that grant is live, in this org, with `finance`. Money tables
  (`MONEY_TABLES`): all nine `payments` tables, `orders.invoices`, `orders.invoice_payments`,
  `orders.credit_notes`, `orders.credit_note_applications`.
- Finance opt-in grants require two-step verification of the agency user, like finance members.

**Agency pages (module `agency`, tier 6, schema `agency`).** `agency.client_snapshots` (one row
per client) and `agency.event_snapshots` (one row per upcoming or recent client event), both owned
by the **agency**. `agency.refreshSnapshots` (entitlement `agency`, `agency:read`; the pages'
"Refresh numbers") and the outbox subscriber `agency.snapshots` (grant created, changed, revoked)
compute each client **under the client's own tenant** (a system actor of the client) from its
exported read functions and projections only: events, `reports.metric_snapshots` through
`eventHeadlineTx` (live while an event has no projection), and the marketing analytics totals for
the last 30 days. Gross sales are stored only with the finance opt-in (CHECK). Queries
`agency.clients` and `agency.events` read only the agency's rows, joined to the live grant list
(`tenancy.agency_client_grants()`), so a revoked client disappears at once and money hides as soon
as the opt-in is withdrawn.

**Web.**
- Client: Settings-level page **Agencies** (`/o/{org}/agencies`, nav "Agencies"): give access
  (address, role radios, money checkbox; inline field errors; success message), the live list
  (access, money, since; "Allow money / Stop money"; "Revoke"), past access. Viewers see the list
  read-only; agency users get the no-access state.
- Agency: `/o/{agency}/agency` with tabs **Clients | Events | Marketing | Reports**, one primary
  action ("Refresh numbers"), empty state naming the agency's address. 404 outside agency orgs or
  without the `agency` entitlement.
- Shell: the org switcher lists **Clients** ("via {agency}") under the user's organizations; every
  page of a client reached through a grant shows the **"via Agency"** badge with "Back to
  {agency}". The org nav hides the client's own settings from agency roles (`AGENCY_NEEDS`).
- Command Center, realtime channels, private media, uploads, email previews, portal files and the
  seat stream accept the live grant the same way (`orgActor`).
- Dev only: `/api/dev/user` `org=agency` makes an agency org with the entitlement (e2e).

**Cross-org reads** go only through SECURITY DEFINER functions (hand-written in the migration,
`REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`), returning allowlisted columns:
`tenancy.resolve_agency(slug)`, `tenancy.agency_profiles(ids)`, `tenancy.agency_access()` and
`tenancy.agency_client_grants()` (org and user from the transaction settings, never parameters),
`tenancy.user_agency_clients(user)` (the switcher, like `user_memberships`). `platform_reader` is
not used.

### 4. Later / not yet
- Agency v2 (M6.8a/b, behind a flag): the agency pays for clients, commission as a second
  transfer, templates and brand kits published downward, per-client campaign fan-out, handover /
  detach, team and day-of grants.
- A scheduled snapshot refresh (worker cron); today: on grant changes (subscriber) and on demand.
- Agency access to the Scan PWA supervisor actions, `/v1` and `GET /v1/me/organizations`.
- Revoking during a read-only cutover freeze waits for the freeze (CLAUDE.md allows only scans
  and provider completions during a freeze) — pending owner.
- Grants per agency team or per person (today: every member of the agency except collaborators).
- Seeded demo agency persona (the e2e makes its own agency through the dev route).

### 5. Acceptance
| Criterion | Test |
|---|---|
| A revoked grant cuts access on the next request (no cached session keeps it) | `packages/testing/tests/agency.int.test.ts` "a revoked grant cuts access on the next request" (the same context object is refused; money rows 0); `apps/web/e2e/agency.spec.ts` first test (404 after revoke) |
| An agency user never reads a client's money tables without the finance opt-in, over every money table | `agency.int.test.ts` "an agency user never reads a client money table…" (every `payments` table is listed; every money table has the guard; 0 rows without, all rows with, 0 again after withdrawal; inserts refused; A's grant never opens B's money) |
| Tenant from route/session only; grant check in the command/query path | `agency.int.test.ts` "a grant to org A opens A … and never B" (context must name the live grant; another agency, another org or a stranger is refused) |
| Agency user without a grant sees nothing; a grant to A never exposes B | `agency.int.test.ts` first and third tests; snapshots test (B absent) |
| Audit rows record the agency actor and grant | `agency.int.test.ts` "audit rows record the agency…" |
| Pages read only from snapshots; money only with opt-in | `agency.int.test.ts` snapshots and subscriber tests; `agency.spec.ts` second test |
| E2E: client grants and revokes, agency switches with the badge, reports render; keyboard only, axe both themes, RTL | `apps/web/e2e/agency.spec.ts` (5 tests × 3 viewports) |
| Pure rules (next event, live count, check-in rate, totals per currency) | `packages/modules/agency/tests/domain.test.ts` |
