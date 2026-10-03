# Spec: M6.8 — Agency v2

- **Milestone:** M6.8 (roadmap Phase 6, "M6.7/6.8 Agency"; Phase 6 plan `docs/plans/phase-6.md`, Wave 3: M6.8a money, M6.8b operations)
- **Status:** M6.8b built (2026-10-03), behind the platform switch `agency_v2` (off by default)
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** P6-8 (agency v2 behind a flag), P6-13 (entitlement `agency`), D23; M6.7a agency v1 (`docs/specs/M6.7/spec.md`), M1.4b templates, M3.6b campaigns, M1.4e brand kit

## M6.8b — Agency v2 operations (done)

### 1. Goal and users
An agency that runs events for several clients publishes its proven templates and brand kits to
them, sends one marketing message as each client's own campaign, decides which of its people
work for which client (and lets event-day freelancers in for one event), and hands a client over.
A client can leave at any time with all its data.

### 2. Scope (built)
**Switch.** Everything below is behind the platform switch `agency_v2` (`platform.flags`, staff
change it through `platform.set_flag`; CLI `pnpm --filter @yayatoh/worker agency-v2 -- --on
--reason "…"`), plus the `agency` entitlement on the agency org. Commands check the switch in
their transaction; the pages and tabs 404 / hide while it is off.

**Module `agency-ops` (tier 7, schema `agency_ops`).** It calls templates, campaigns, audiences,
events and tenancy down the tiers. Client-side writes are made by the agency person **acting
through the client's live grant** (`ctx.viaAgency`), so the client's authorizer (grant role, team
and day-of rules), audit (`viaAgency`, `agencyGrantId`) and row security apply unchanged.

- **Templates published downward.** The agency marks what of a template stays private
  (`template_settings`: private notes, and optionally the checkout questions and the seating plan).
  `publishTemplate` sends the public snapshot (`publicSnapshot`) to each chosen client, where
  `agencyOps.receiveTemplate` (client, `events:write`: a manager grant) creates **the client's own
  template** (a name clash gets the agency's name in brackets) or updates its earlier copy. A
  marketing or viewer grant is refused for that client (`forbidden`), a client without a live
  grant `not_found`; each outcome is recorded in `publications`.
- **Brand kits published downward.** The agency's kits (`brand_kits`: name, accent colour,
  private notes) are copied (name and colour only; a CHECK keeps notes off received kits) into the
  client's library by `agencyOps.receiveBrandKit` (client, `marketing:write`). Applying a kit to the
  client's public pages is the client's own decision (`agencyOps.applyBrandKit`, `org:update`,
  never an agency role).
- **Per-client campaign fan-out.** `fanOutCampaign` records the agency message (`fanouts`) and,
  one client at a time, creates in each client: a campaign named after it (the agency's name in
  brackets on a clash), a saved audience in the client's own segment DSL (everyone, or attendees of
  any of its events), the content with **the client's own postal address** in the footer, then
  (send mode) the client's own `campaigns.sendNow` with an idempotency key per fan-out and client.
  Recipients are resolved by each client's send snapshot with **its** consent and suppression rules;
  the agency stores only ids and statuses (`fanout_targets`: sent, draft, needs_address, failed,
  detached). A client with no postal address yet gets a draft (`needs_address`).
- **Team and day-of grants** (`tenancy.agency_staff_grants`, owned by the client). The agency
  (`agency:manage`) names a team per client (once named, only the team acts through the grant;
  collaborators can't be on a team) and gives day-of passes for a client event (default window:
  three hours before to three hours after, at most 72 hours; collaborators allowed, for event-day
  freelancers). Roles are capped at the grant's role. The client lists and revokes them on its
  Agencies page. `tenancy.agency_access()` and `tenancy.user_agency_clients()` (replaced in the
  migration) apply the rules **per request with the database clock**, so a pass works only inside
  its window and a revoked row or an expired pass is refused on the next request.
- **Handover and detach.** `agencyOps.detachAgency` (client, `members:manage`, one click like
  revoking) and `handOverClient` (agency, `agency:manage` + step-up, then the same command in the
  client as a system actor) revoke the grant, every team place and pass under it, and clear the
  links back to the agency's originals (`received_items.source_id`). **Nothing of the client is
  deleted**: events, orders, contacts, campaigns and the received copies stay. The client gets a
  `detachments` row (what it kept) and `agency_ops.client_detached@1` marks the agency's
  publications and pending targets `detached` (subscriber `agency-ops.detached`, worker).
- **Permissions:** `agency:manage` (owners, admins, managers) and `agency:campaigns` (plus the
  marketing role); both are `agency:*`, so they never apply through a grant (`AGENCY_NEVER`).

**Cross-org reads** go only through SECURITY DEFINER functions: `tenancy.agency_client_grants()`
(M6.7a) and the new `tenancy.agency_staff_of_agency()` (the agency's live staff rows; agency from
the transaction, allowlisted columns). `tenancy.agency_staff_role(…)` is an internal helper of the
access functions (no grant to `app_user`). `platform_reader` is not used by the web.

**Web.**
- Agency: new tabs **Library** (templates: private notes and parts, publish to chosen clients with
  per-client outcomes; brand kits: create with inline validation, publish), **Campaigns** (one form,
  fan-out history with outcome counts), **Team** (per client: team table and add form, day-of
  passes table and give form, revoke buttons, handover with step-up).
- Client Agencies page: **Detach** next to each live grant (success alert with what it kept),
  **People from your agencies** (revoke), **Brand kits from your agencies** (apply), **Received
  from your agencies**.
- Every new empty state has a primary action (U2 audit); the M6.7a agency empty states got theirs
  in the same change.
- Dev only: `/api/dev/user` `org=agency&template=1` gives the agency a saved template (e2e).

### 3. Later / not yet
- Logos and fonts in brand kits (today: name and accent colour); applying a kit to a single event.
- Scheduled fan-outs, SMS fan-outs, per-client audience choice and per-client message tweaks.
- Re-sending the agency message into a `needs_address` draft once the client adds its address.
- Custom day-of windows in the UI (the command accepts them; the page uses the event's window).
- A handover that also transfers org ownership (today it ends the agency's access; the client's
  own owners stay as they are).
- Agency v2 money (M6.8a: agency pays, commission transfers) is a separate increment.

### 4. Acceptance
| Criterion | Test |
|---|---|
| **Detaching a client leaves the client with all its data and none of the agency's templates' private parts** | `packages/testing/tests/agency-ops.int.test.ts` "detaching leaves the client all its data and none of the agency templates’ private parts" (row counts of events, templates, kits, campaigns, contacts unchanged; canary notes and private parts absent everywhere in the client; links cleared; access refused next request) and "the agency hands a client over"; `apps/web/e2e/agency-ops.spec.ts` third test |
| A fanned-out campaign never mixes recipients across orgs; each send honours that org's consent | `agency-ops.int.test.ts` "sends one campaign per client in its own org…" (disjoint recipient sets, every recipient in its own org's crm, consent_missing / consent_withdrawn excluded per org, the client's own postal address) |
| A day-of grant expires on time and on revoke (next request) | `agency-ops.int.test.ts` "a day-of pass works only inside its window and stops on revoke at the next request" (not before start; refused once the end passes; agency revoke and client revoke both refuse the same context next request) |
| Templates and brand kits published downward; the client owns its copy; private parts stay | `agency-ops.int.test.ts` "templates and brand kits published downward" (2 tests); `agency-ops.spec.ts` first test |
| Team grants narrow access; roles capped; collaborators only by day-of | `agency-ops.int.test.ts` "a named team narrows who acts through the grant" |
| Behind the switch | `agency-ops.int.test.ts` "is refused while staff have not switched agency v2 on" |
| E2E: publish a template and brand kit, fan out a campaign, detach; keyboard only, axe both themes, RTL | `apps/web/e2e/agency-ops.spec.ts` (4 tests × 3 viewports) |
| Pure rules (private parts, fan-out content and audiences, day-of windows, role caps) | `packages/modules/agency-ops/tests/domain.test.ts`, `packages/modules/tenancy/tests/permissions.test.ts` |
