# Spec: M6.6 — Subscription billing

- **Milestone:** M6.6 (roadmap Phase 6; `docs/plans/phase-6.md` rows M6.6a, M6.6b)
- **Status:** M6.6a built (dormant behind `BILLING_ENABLED`); M6.6b not started
- **Risk tags:** db-migration, payments, tenancy
- **Decisions:** D12, D16, D22, P6-1, P6-7, P6-13

## M6.6a — Billing foundation (dormant) (done)

### 1. Goal and users
Model subscription billing completely, so prices and plans switch on later with no code change,
while nothing changes for any organization today. Platform staff and the owner get a plan catalog
mirrored from the billing provider (Stripe Billing + Entitlements), organizers (owners, admins,
finance) get a read-only plan page, and a plan change reaches an org's modules through the
provider's webhook alone (the roadmap acceptance).

### 2. What was built
- **Billing provider port** (`packages/modules/billing/src/provider/`): `BillingProvider` with
  `listCatalog`, `createCustomer` and `verifyWebhook` (raw body), normalizing to subscription,
  entitlement-summary, catalog and ignored events.
  - **Fake** (`fake.ts`): dev, preview and CI; webhooks HMAC-signed with a key derived from
    `FAKE_PAYMENTS_SECRET` (never the payments key itself); deterministic customer and
    subscription ids; serves the placeholder catalog. Refused in production.
  - **Stripe** (`stripe.ts`): the official SDK pinned to the payments adapter's API version;
    `customer.subscription.*` (price lookup key → plan), `entitlements.active_entitlement_summary.updated`
    (full feature set; lists every active entitlement when the event's list is truncated),
    catalog events (`product.*`, `price.*`, `entitlements.feature.*`). Live keys are refused outside
    production. Tested only over a fake `fetch` with test-mode object shapes; never called from CI.
  - `BILLING_PROVIDER` chooses it explicitly (default `fake`), so Stripe keys in an environment
    never switch dev or CI off the fake. `BILLING_ENABLED` (unset = off) gates everything.
- **Plans as data** (global reference data, app_user read-only):
  - `billing.plan_catalog` (plan on/off, order, provider product id),
    `billing.plan_prices` (by the provider price's lookup key, e.g. `tier_pro_month_usd`; amount
    null = quoted), `billing.features` (Entitlement Features by module key). Plan → modules stays
    `billing.plan_modules`.
  - The research tiers Free $0 / Starter $29 / Pro $99 / Agency $249 / Enterprise (quote) are
    seeded as **placeholders, switched off** (`PLACEHOLDER_PLANS` in `src/catalog.ts`; an
    integration test keeps the migration and the constant in step). Each tier's fee schedule is a
    copy of the legacy one, so a plan change never moves an org's per-ticket fees by accident.
  - **Catalog sync** (worker, `apps/worker/src/billing-catalog.ts`): products with `plan_key`
    metadata become plans, their attached Entitlement Features their modules, recurring prices with
    a lookup key their prices. Written through the SECURITY DEFINER `billing.apply_catalog`
    (platform_reader only, audited); objects gone from the provider are switched off, never
    deleted; `launch_standard` is never touched. Hourly while billing is on (leader only), and by
    hand: `pnpm --filter @yayatoh/worker billing:sync-catalog`.
- **Webhook sync**: `POST /api/webhooks/billing/{fake|stripe}` → `processBillingWebhook`:
  404 while billing is off or for another provider's endpoint; raw-body verification (failures
  rate-limited per IP, M1.14a); the customer's org via the SECURITY DEFINER
  `billing.org_for_customer`; then `billing.applyProviderEvent` as a system command:
  - deduplicated by the provider's event id (`billing.provider_events`);
  - ordered by the provider's event time (an older event is `stale` and changes nothing);
  - subscription events upsert `billing.subscriptions` and, unless the org's legacy fees are
    grandfathered, move its fee plan (`billing.org_plans`) with the subscription (back to the
    default when it ends);
  - entitlement summaries replace `billing.org_entitlements` (module keys only);
  - emits `billing.subscription_changed@1`, `billing.entitlements_synced@1` (added/removed keys).
- **Effective modules** (`effectiveModulesTx`): with billing on and a live subscription
  (trialing, active, past_due) whose entitlements were synced, the org's modules are those
  entitlements plus `core` (a misconfigured product can never lock an org out of its console),
  plus grants, minus revokes. Otherwise, and always with billing off, exactly the pre-billing
  query (plan modules ± overrides). Feature code keeps checking module keys only.
- **Customers**: `ensureBillingCustomer` creates the org's customer through the port
  (idempotency key per org) and records it (`billing.linkCustomer`, system only; a second,
  different customer is refused).
- **Legacy fee grandfathering**: `billing.org_billing.legacy_fees_grandfathered` with a reason.
  The migration flags every org that exists (`existing_org`, or `legacy_migration` when it came
  from the legacy platform); the legacy migration's T2 transform flags every organizer it creates;
  staff can change it (`billing.setLegacyFees`, `platform:entitlements.manage`, audited).
- **P6-13 module keys** registered: `api_access`, `integrations`, `enterprise`, `agency`,
  `virtual`, `advanced_seating`, `ai_seating`, `analytics_pro` (on `launch_standard`: free in beta).
- **Plan page** `/o/{org}/plan` (owners, admins, finance; linked from Settings): current plan and
  its source, subscription status and price, renewal date (org time zone), per-ticket fee status,
  the org's modules, the placeholder catalog. Read-only. Allowlist DTO (`PlanSummaryDto`): no
  provider, customer or event ids.
- **Test billing portal** (development and CI only: billing on, fake provider, dev auth, never
  production): the plan page mints a signed link to `/billing/fake`, a stand-in for the provider's
  portal that sends the subscription and entitlement-summary webhooks to our endpoint.
- The e2e server runs with `BILLING_ENABLED=1` and the fake provider; billing applies only to orgs
  with a billing customer (none of the seeded ones), so every other spec runs as before.

### 3. Acceptance
| Criterion | Test |
|---|---|
| A plan change alters modules through the webhook alone, with no feature-code change | `packages/testing/tests/billing-subscriptions.int.test.ts` › "a downgrade removes a module and an upgrade brings it back" (the program module's own `sessions` entitlement check refuses, then allows) |
| Replayed webhooks are idempotent; late events never roll back | same file › "replays and ordering" |
| Billing off: nothing changes (webhook 404, nothing written, modules exactly as before even with synced data) | same file › "billing off"; e2e `billing-plan.spec.ts` › billing-off smoke and the seeded org |
| Webhooks verified on the raw body; forged → 400; wrong provider → 404; unknown customer acknowledged | same file › "webhook verification and routing"; `packages/modules/billing/tests/fake-provider.test.ts`, `stripe-billing.test.ts` |
| Tenant isolation | same file › "tenant isolation"; isolation suite (fixture rows for both orgs) |
| Permissions: system-only writes, viewers refused the plan page | same file › "permissions"; e2e › viewer refusal |
| Plans, prices and Entitlement Features mirrored through the port; placeholders switched off | `apps/worker/tests/billing-catalog.int.test.ts`; `catalog-sync.test.ts`; seeded catalog tests |
| Legacy fee grandfathering flags | `billing-subscriptions.int.test.ts` › "fee plan follows … grandfathered keeps legacy fees"; `tools/legacy-migrate/tests/migrate.int.test.ts` (T2) |
| Every P6-13 key registered | `billing-subscriptions.int.test.ts` › "registers every Phase 6 module key" |
| E2E: plan page; simulated upgrade via the fake webhook shows a module appearing; keyboard only; axe; RTL | `apps/web/e2e/billing-plan.spec.ts` (375/768/1280) |

### 4. Migration (`0113_calm_viper`, renumbered from `0103_chilly_grandmaster`)
New tables only (expand). Global: `billing.plan_catalog`, `billing.plan_prices`, `billing.features`.
Tenant (RLS ENABLE + FORCE, the NULLIF policy, org-leading indexes): `billing.org_billing`,
`billing.subscriptions`, `billing.org_entitlements`, `billing.provider_events`. Hand-written
(between the markers): grants/revokes, the placeholder seed, tier fee schedules copied from the
legacy plan, the P6-13 keys on `launch_standard`, the grandfathering backfill, and the SECURITY
DEFINER functions `billing.org_for_customer` (app_user) and `billing.apply_catalog`
(platform_reader).

### 5. Pending owner (owner inbox)
- Real tiers, prices and module sets (D22); placeholder tier fee schedules equal the legacy ones.
- What a non-grandfathered org falls back to when its subscription ends (built: the default
  `launch_standard`, i.e. never worse than today; M6.6b adds read-only dunning).
- Stripe account setup when billing goes live: products with `plan_key`/`sort_order` metadata,
  prices with lookup keys, Entitlement Features whose lookup keys are module keys, and a billing
  webhook endpoint (`STRIPE_BILLING_WEBHOOK_SECRET`).

### 6. Not yet / later
- M6.6b: meters (messaging, AI, devices), in-app upgrade/downgrade with proration, checkout,
  dunning to read-only, Stripe Tax, the nonprofit discount, usage pages.
- An admin screen for grandfathering and the catalog sync (the command and CLI exist).
- A nav entry for the plan page (it is linked from Settings; the shell is left alone while design
  v2 lands).
