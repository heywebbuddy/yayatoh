# Spec: M6.8 — Agency v2

- **Milestone:** M6.8 (roadmap Phase 6, "M6.7/6.8 Agency"; Phase 6 plan `docs/plans/phase-6.md`, Wave 3: M6.8a money, M6.8b operations)
- **Status:** M6.8a and M6.8b built (2026-10-03), both behind the platform switch `agency_v2` (`platform.flags`, off by default; batch 3m merge: one switch for both, see M6.8a §2 "Flag and entitlement")
- **Risk tags:** `payments`, `tenancy`, `db-migration` (owner approval before main)
- **Related:** owner decisions P6-1 (behind flags, fakes only), P6-8 (agency v2: agency pays for clients, commission as a second transfer, explicit reversals; commission defaults are the owner's), P6-13 (entitlement `agency`), D23 (clients pay first in v1); roadmap §5.3 (hybrid funds flow: "agency commission is a second transfer in the same group", "per agency: `commission_held`", explicit transfer reversals); M6.7a (grants, money guard, snapshots), M6.6a/b (billing, entitlements, dunning), M1.6b/c/e (refunds, settlements, receivables, reconciliation)

## M6.8a — Agency v2 money (done)

### 1. Goal and users
An **agency** that runs a client's events can **pay the client's Yayatoh plan** and, in return,
**earn a commission** on the client's ticket sales. The client's owner or admin accepts the
agency's offer and can stop it at any time. The commission reaches the agency as **its own transfer
in the event's transfer group** when the event's money is released, and **refunds take it back in
proportion**, by explicit transfer reversals once it was transferred. Both sides read a
**commission statement** built from ledger entries only. Nothing here touches live money: the fake
provider runs in dev and CI, and live commission waits for live Stripe (P6-8).

### 2. Scope (built)

**Flag and entitlement.** `agency_v2` is an environment flag, `AGENCY_V2_ENABLED` (unset = off, like
`BILLING_ENABLED`): off, no offer can be made or accepted, no agency covers a client and no
commission accrues (commission already earned is still released and reversed, so money in flight
is never stranded). It applies to agency orgs with the `agency` entitlement (P6-13; free on every
plan in beta, staff revoke it per org). A module key `agency_v2` was tried and dropped: M6.6a's
invariant is that the default plan carries every module key.

**Agency pays for clients (billing, tier 1).**
- `billing.agency_billing_offers` (owned by the **agency**; one live offer per client) and
  `billing.agency_billing` (owned by the **client**; one live row per client: grant, agency,
  `commission_bps`, accepted by/at, ended by/at/reason `client | agency | grant_revoked | staff`).
- Commands: `billing.offerAgencyBilling` (agency, `billing:manage`, entitlement `agency`, step-up;
  the client must have given the agency a live grant), `billing.withdrawAgencyBillingOffer`
  (agency, no step-up, works with the flag off), `billing.acceptAgencyBilling` (client,
  `billing:manage`, step-up; only a live offer), `billing.endAgencyBilling` (client, one click),
  `billing.setAgencyCommission` (staff, `platform:entitlements.manage`). Queries
  `billing.clientAgencyBilling` (`members:read`) and `billing.agencyBilledClients` (`agency:read`).
  Events `billing.agency_billing_offered|withdrawn|started|ended@1` (internal, `platform`).
- **In force** = the live acceptance, its grant still live, the offer standing, the agency a live
  agency org with `agency`, and the flag on (`billing.agency_billing_active()`). While in force the
  agency's plan modules (its synced entitlements when billing is on and its subscription is live)
  are added to the client's effective modules (`billing.agency_cover_modules()`), never the
  agency's own `agency` key, and nothing while the agency is read-only for an unpaid subscription.
  The client's own plan, overrides and revokes still apply.
- Revoking the grant stops it at once (the database checks the grant); the subscriber
  `billing.agency-grant-revoked` then ends the row (`grant_revoked`).
- Agency users acting through a grant hold no `billing:*` permission, so they can never accept for
  the client.

**Commission (payments, tier 3; `platform_mor` only).**
- **Sale:** with agency billing in force, `postSaleTx` accrues `floor((total − fee) × bps / 10 000)`
  (journal `commission:<order>`, kind `agency_commission`): `org:payable_held` → `agency:commission_held`
  (same event). `organizer_mor` direct charges never earn commission (later).
- **Release:** the release job (`payments.releaseDueSettlements`, step 2b) turns the agency's held
  commission on a released event into a `commission` settlement (`settlements.agency_org_id`), after
  netting what the agency owes back (`agency:commission_receivable`). `settleOrg` transfers it to the
  agency's connected account with the **event's `transfer_group`** — a second transfer beside the
  organizer's. The destination comes from `payments.agency_payout_destination(agency)` (only an
  agency this client has agency billing with; payouts enabled, not held, past its 24 h hold);
  without one the settlement waits (`waiting_account`) and is offered again on every run.
  `payments.recordTransfer` books a commission transfer as `agency:commission_held` → platform cash
  (reconciled under `settlement:<id>` like any transfer).
- **Refund:** `postRefundTx` first reverses commission **proportionally to the refunded amount of the
  organizer's share** (each refund's amount less the platform fee it returns), **cumulatively**: after
  refunds giving back `r` of the share `base`, the reversed total is `floor(commission × r / base)`, and
  exactly the whole commission once the share is fully refunded, so partial refunds add up to the
  cent. Not yet transferred: back to the organizer's held funds (a waiting commission settlement
  shrinks). Already transferred: the agency owes it (`agency:commission_receivable`), the organizer's
  held funds get it back for the refund, and `refundAtProvider` makes an **explicit transfer reversal**
  of the commission transfer (idempotency key `commission_reversal:<refund>`), recorded by
  `payments.recordCommissionReversal`; if it fails the debt stays owed and is netted from the
  agency's next commission. The organizer's own reversal is unchanged and never targets the
  agency's transfer. **No call ever uses `reverse_transfer`.**
- **Mirror:** every movement emits `payments.agency_commission@1` (internal, `security`); the
  subscriber `payments.agency-commission` posts a balanced **mirror journal in the agency's own
  ledger** (`agency:commission_due|earned|paid|clawback`, never platform cash), idempotent per
  movement. The agency's books never read a client money table.

**Statements (ledger entries only).** `payments.clientCommissionStatement` (client, `finance:read`:
its own `agency:*` postings) and `payments.agencyCommissionStatement` (agency, `finance:read`: its
mirror journals). Totals per currency: earned (net of refunds), waiting for release, transferred,
owed back; entries: accrued, reversed, clawback, transferred, netted, clawback paid. The two agree.

**Web.**
- Client: an **Agency billing** section on Agencies (`/o/{org}/agencies`): an agency's offer (with
  the default rate) and **Accept** (owners and admins, step-up), the billing in force or paused with
  **Stop agency billing**, a read-only note for other roles, success messages, and for finance roles
  the **Commission statement**.
- Agency: a **Billing** tab on its Clients pages (`/o/{agency}/agency/billing`, only with the flag):
  each client's status (not offered, offered, paying at a rate), **Offer to pay plan** / **Withdraw
  offer** (owners and admins), empty state, and the agency's statement for its finance roles.
- Messages `agencyBilling.*` and `agency.tab.billing` in all 13 locales.

**Migration** (`0142_lean_hex.sql`, renumbered at merge): the two billing tables (RLS enabled and
forced, org-scoped indexes); `payments.settlements.agency_org_id`; hand-written: the ledger account
CHECK and the settlement CHECKs re-added `NOT VALID` then validated; SECURITY DEFINER functions
`billing.org_has_module` (internal, not granted), `billing.agency_offers_for_me()`,
`billing.agency_billing_active()`, `billing.agency_cover_modules(bool)`,
`billing.agency_client_live(uuid)`, `billing.agency_billed_clients()`,
`payments.agency_payout_destination(uuid)`; `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`.
The org always comes from the transaction settings; parameters are checked against it.

### 3. Later / not yet
- Live commission money waits for live Stripe (P6-8); the Stripe adapter already sends the
  transfer group and explicit reversals.
- Commission on `organizer_mor` (direct charges: an application-fee split), on add-on and donation
  orders' own flows beyond `postSaleTx`, and a reserve on commission (none today) — pending owner.
- The agency's actual subscription charge for covered clients (seat or per-client metering) once
  prices exist (D22); today coverage changes modules only and the dormant billing charges nothing.
- An admin screen for `billing.setAgencyCommission` (staff use the command today).
- Netting an agency's debt across clients (today per client ledger).
- M6.8b: templates and brand kits downward, per-client fan-out, handover/detach, team grants.


## M6.8b — Agency v2 operations (done)

- **Related (M6.8b):** P6-8 (agency v2 behind a flag), P6-13 (entitlement `agency`), D23; M6.7a agency v1 (`docs/specs/M6.7/spec.md`), M1.4b templates, M3.6b campaigns, M1.4e brand kit

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
| A refund reverses the commission proportionally (partial and full refunds, to the cent) | `packages/testing/tests/agency-money.int.test.ts` ("a partial refund before release…", "a refund after transfer reverses…", "a full refund reverses exactly the whole commission…": 616 + 617 + 617 = 1 850); `packages/modules/payments/tests/commission.test.ts` (2 000 random refund plans) |
| No `reverse_transfer` on separate charges & transfers (the provider calls) | `agency-money.int.test.ts` (Stripe adapter over the in-memory fake Stripe API: every request body checked; reversals are `POST /v1/transfers/{id}/reversals`; the commission is a second `POST /v1/transfers` with the event's `transfer_group`) |
| Commission as a second transfer in the same transfer group, released at transfer time | `agency-money.int.test.ts` "at release the commission is a second transfer…" |
| Commission rate per agency–client grant (owner default, staff change) | `agency-money.int.test.ts` first test (default 1 000 bps, staff set 1 234, the client cannot) |
| Agency pays for clients; the client opts in; flag and entitlement | `agency-money.int.test.ts` "is off behind the agency_v2 flag…", "needs the agency entitlement…", "the agency's plan covers the client…", "revoking the grant ends agency billing…" |
| An agency without a finance grant never reads client money tables | `agency-money.int.test.ts` "an agency without a finance grant…" (0 rows of journals, postings, settlements; client statement and billing refused); `agency.int.test.ts` (every money table) |
| Statements for agency and client from ledger entries only, and they agree | `agency-money.int.test.ts` "statements for client and agency…" (mirror idempotent, the agency's ledger never touches platform cash, both books balance) |
| Tenant isolation of the new tables | `packages/testing/tests/isolation.int.test.ts` (fixture rows for both orgs) |
| E2E: client opts in, a sale pays commission, a refund reverses it; statements; keyboard only, axe both themes, RTL; permission denials | `apps/web/e2e/agency-billing.spec.ts` (3 tests × 3 viewports) |
| **Detaching a client leaves the client with all its data and none of the agency's templates' private parts** | `packages/testing/tests/agency-ops.int.test.ts` "detaching leaves the client all its data and none of the agency templates’ private parts" (row counts of events, templates, kits, campaigns, contacts unchanged; canary notes and private parts absent everywhere in the client; links cleared; access refused next request) and "the agency hands a client over"; `apps/web/e2e/agency-ops.spec.ts` third test |
| A fanned-out campaign never mixes recipients across orgs; each send honours that org's consent | `agency-ops.int.test.ts` "sends one campaign per client in its own org…" (disjoint recipient sets, every recipient in its own org's crm, consent_missing / consent_withdrawn excluded per org, the client's own postal address) |
| A day-of grant expires on time and on revoke (next request) | `agency-ops.int.test.ts` "a day-of pass works only inside its window and stops on revoke at the next request" (not before start; refused once the end passes; agency revoke and client revoke both refuse the same context next request) |
| Templates and brand kits published downward; the client owns its copy; private parts stay | `agency-ops.int.test.ts` "templates and brand kits published downward" (2 tests); `agency-ops.spec.ts` first test |
| Team grants narrow access; roles capped; collaborators only by day-of | `agency-ops.int.test.ts` "a named team narrows who acts through the grant" |
| Behind the switch | `agency-ops.int.test.ts` "is refused while staff have not switched agency v2 on" |
| E2E: publish a template and brand kit, fan out a campaign, detach; keyboard only, axe both themes, RTL | `apps/web/e2e/agency-ops.spec.ts` (4 tests × 3 viewports) |
| Pure rules (private parts, fan-out content and audiences, day-of windows, role caps) | `packages/modules/agency-ops/tests/domain.test.ts`, `packages/modules/tenancy/tests/permissions.test.ts` |
