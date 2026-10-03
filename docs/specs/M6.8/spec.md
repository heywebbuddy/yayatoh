# Spec: M6.8 — Agency v2

- **Milestone:** M6.8 (roadmap Phase 6, "M6.7/6.8 Agency"; Phase 6 plan `docs/plans/phase-6.md`, Wave 3: M6.8a money, M6.8b operations)
- **Status:** M6.8a built (2026-10-03), behind the flag `agency_v2` (`AGENCY_V2_ENABLED`, off unless set); M6.8b follows
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
