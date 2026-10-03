# Spec: M6.6 — Subscription billing

- **Milestone:** M6.6 (roadmap Phase 6; `docs/plans/phase-6.md` rows M6.6a, M6.6b)
- **Status:** M6.6a and M6.6b built (dormant behind `BILLING_ENABLED`; fake provider in dev and CI)
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
- M6.6b (done below): meters, in-app plan changes with proration, dunning to read-only, tax, the
  nonprofit discount, usage pages.
- An admin screen for grandfathering and the catalog sync (the command and CLI exist).
- A nav entry for the plan page (it is linked from Settings; the shell is left alone while design
  v2 lands).

## M6.6b — Meters and plan changes (dormant) (done)

### 1. Goal and users
Meter what costs money to run (messages, AI credits, scan devices), let owners and admins change
plan in-app with the provider's proration preview, and turn a failed renewal into a read-only
org (never data loss) until it pays. Organizers (owners, admins, finance) see usage per meter;
owners and admins change plans and pay. Everything stays dormant behind `BILLING_ENABLED`; the
fake provider stands in for Stripe in dev and CI; nothing calls Stripe.

### 2. What was built
- **Meters** (`packages/modules/billing/src/meters.ts`), messaging per channel (D16), AI credits
  (D12) and devices (P6-7):
  - usage events on the outbox: `messaging.usage_metered@1` (the notifications dispatcher, per
    message handed to a provider: email, SMS by segment, WhatsApp; push is free),
    `ai.credits_spent@1` / `ai.credits_refunded@1` (the AI credits ledger; a refund counts
    negative), and the existing `device.enrolled@1`. Payloads name the message or debit, never a
    recipient or content.
  - `billing.usage-meter` subscriber → `billing.usage_records`, one row per (event, meter):
    idempotent by the outbox event id (unique key on top of the processed-events ledger), so a
    redelivery or replay never counts twice. Usage is counted while billing is dormant too.
  - reporting: the worker's billing pass (every 5 minutes while billing is on, leader only;
    `apps/worker/src/billing-usage.ts`) sends unreported records to the provider's meter API
    (`BillingProvider.reportUsage`, Stripe meter events `yayatoh_{meter}` with our record id as
    the identifier), from the org's first subscription on and within the provider's 35-day
    window; a record is marked only after the provider accepted it (`billing.markUsageReported`,
    system, audited); refusals are retried and counted.
- **Usage page** `/o/{org}/plan/usage` (owners, admins, finance; linked from the plan page): this
  calendar month and the 12 before it, per meter, in the org's time zone (`billing.usageSummary`;
  allowlist DTO), filter tabs per meter, whether usage is sent to the provider, empty states.
- **In-app plan changes** (`packages/modules/billing/src/plan-change.ts`):
  - `billing.planChangeOptions`: offered prices (catalog plans on sale; the switched-off
    placeholders only with the fake provider outside production, like the test portal; quoted
    prices never), each with its direction (start, upgrade, downgrade, switch) and the modules it
    turns off and on.
  - `previewPlanChange`: the provider's invoice preview (proration as of an instant, the coupon,
    tax by the provider's tax setting). The fake computes it with `prorate` (integer minor units;
    a flat 8 % stands in for Stripe Tax); Stripe uses `invoices.createPreview` with automatic tax.
  - `billing.changePlan` (owners and admins, `billing:manage`; money category; Idempotency-Key
    required): records the confirmed change (`billing.plan_changes`), refusing a change that turns
    modules off unless the organizer confirmed them (`confirmRemoved`); then the provider is
    called (`changeSubscriptionPlan`, idempotency key per change) and its webhooks, not the
    command, move the subscription, the fee plan and the modules (the M6.6a acceptance holds).
  - Plan page: "Change plan" picker → preview page (credit, charge, discount, tax, due today,
    next renewal, and a warning listing the modules that turn off with a required
    acknowledgement) → confirm; "Keep my plan" leaves it.
- **Dunning to read-only** (`dunning-rules.ts`, `dunning.ts`):
  - subscription webhooks move the org's dunning state (`org_billing.dunning_started_at`,
    `grace_ends_at`, `read_only_at`): `past_due` starts a 14-day grace (once); `unpaid` (the
    provider gave up), or the subscription ending while unpaid, makes it read-only at once;
    `active`/`trialing` (paid) clears it. Events: `billing.dunning_started@1`,
    `billing.read_only_started@1`, `billing.dunning_resolved@1`. The grace end needs no job: the
    standing is computed at `now`.
  - the read-only gate (`billingReadOnlyGate`, composed after tenancy's status gate in the web,
    API and test ports): while read-only, writes by the org's members and API keys are refused
    with `read_only_billing` (HTTP 403, "Nothing was saved or deleted") inside the tenant
    transaction before the handler. Reads, exports, paying and changing the plan, personal and
    safety actions, and door scans keep working; ticket buyers, guests, portals, devices and the
    platform are never refused. Nothing is deleted anywhere. Billing off: no read at all.
  - a banner on every console page of the org (grace: "works until {date}"; read-only: what
    still works), rendered through the maintenance banner (no shell change), and a notice on the
    plan page with **Pay now** (`billing.payOutstanding`, owners and admins, idempotent) → the
    provider pays the open invoice and its webhook restores writes; a declined payment says so.
  - the test billing portal (dev only) gained "Fail the renewal payment" (`past_due`) and "Stop
    retrying the payment" (`unpaid`).
- **Tax**: the provider's tax setting (Stripe Tax: `automatic_tax` on previews, changes and new
  subscriptions); the fake applies a flat 8 % so previews show a tax line in dev and CI.
- **Nonprofit discount**: a coupon (`nonprofit`, 20 % off, the research figure) applied from the
  verified charity profile (M4.8b: `donations.charity_verified@1` sets it, a rejection removes
  it unless staff granted it) or by staff (`billing.setNonprofitDiscount`, platform only,
  audited). New subscriptions start with it; the worker's billing pass puts a changed discount on
  the live subscription (`pushNonprofitDiscount`, `setDiscount`). Previews show it.
- Permission `billing:manage` (owners and admins).
- `BillingProvider` gained `previewPlanChange`, `changePlan`, `payOutstanding`, `reportUsage`,
  `setDiscount`; the fake delivers the webhooks a change or payment causes through an injected
  `deliver` (the web app hands them to its own webhook processor).
- Dev/CI route `POST /api/dev/billing` (dev auth only): enrolls scan devices through the real
  command, runs the usage meter and, with billing on, reports usage (e2e).

### 3. Acceptance
| Criterion | Test |
|---|---|
| A failed renewal makes the org read-only and never deletes data; paying restores writes | `packages/testing/tests/billing-dunning.int.test.ts` › "after the grace period the org is read-only…", "the provider giving up … paying restores writes"; e2e `billing-dunning.spec.ts` › "a failed renewal: grace, then read-only…" |
| Meters match usage events exactly over a fixture month (no double count on replay) | `billing-meters.int.test.ts` › "over the fixture month: every meter equals the sum of its events", "a replayed or redelivered event never counts twice", "reports each record once … the provider total equals the events" |
| A plan change still alters modules through the webhook alone | `billing-dunning.int.test.ts` › "previews the proration … a downgrade needs the modules confirmed" (modules move only when the fake provider's webhook is processed); `billing-subscriptions.int.test.ts` (M6.6a) unchanged and green |
| Usage events from messaging, AI credits and devices | `billing-meters.int.test.ts` › "a sent message, a spent or refunded AI credit and an enrolled device each emit a usage event"; `meters.test.ts` |
| Usage page per org: current period, history, by meter, org time zone | `billing-meters.int.test.ts` › "counts months in the org time zone…", "filters by meter…"; e2e › "usage page…" |
| Upgrade/downgrade with the proration preview; downgrades show what turns off first | e2e › "upgrade and downgrade with the proration preview, keyboard only"; `proration.test.ts`; `fake-provider-changes.test.ts`; `stripe-billing.test.ts` (M6.6b block) |
| Who is refused while read-only (members, API keys) and who is not (buyers, portals, devices, platform; exports, paying, door) | `dunning-rules.test.ts`; `billing-dunning.int.test.ts` › "the gate spares buyers, exports and the door" |
| Tax through the provider's tax setting; nonprofit discount from the charity profile or staff | `stripe-billing.test.ts` (automatic tax, coupon); `billing-dunning.int.test.ts` › "nonprofit discount"; `proration.test.ts` |
| Permissions: owners/admins change and pay; finance reads; viewers neither | `billing-dunning.int.test.ts` › permissions; e2e › "a viewer sees neither…; a finance member cannot change the plan" |
| Billing off: nothing changes (never read-only, nothing reported, no preview) | `billing-dunning.int.test.ts` › "billing switched off…"; `billing-meters.int.test.ts` › "billing off…" |
| E2E keyboard only, axe in both themes, RTL | `apps/web/e2e/billing-dunning.spec.ts` (375/768/1280) |

### 4. Migration (`0114_shiny_moondragon`, to be renumbered)
Expand only. New tenant tables (RLS ENABLE + FORCE, the NULLIF policy, org-leading indexes):
`billing.usage_records` (unique per org, source event and meter), `billing.plan_changes` (unique
per org and idempotency key). New nullable columns on `billing.org_billing`: `dunning_started_at`,
`grace_ends_at`, `read_only_at`, `nonprofit_discount`, `discount_changed_at`,
`discount_pushed_at`. Hand-written (between the markers): the two CHECKs on the existing
`org_billing` table added `NOT VALID` then `VALIDATE CONSTRAINT`.

### 5. Pending owner (owner inbox)
- Grace period length (built: 14 days, Stripe's retry window) and who is read-only (built: the
  org's members and API keys; buyers, guests and the door keep working).
- What a read-only org's members may still do (built: look, export, pay or change the plan, door
  scans, personal settings).
- The nonprofit discount (built: 20 % off the plan, research figure) and whether it applies to
  metered usage too (built: the plan only).
- Meter prices and Stripe meters (`yayatoh_email`, `yayatoh_sms`, `yayatoh_whatsapp`,
  `yayatoh_ai_credits`, `yayatoh_devices`, sum aggregation) when billing goes live; devices count
  enrollments.
- `billing:manage` is owners and admins only (finance reads the plan and usage).

### 6. Not yet / later
- Usage-based prices on the plans (the meters exist; their prices are the owner's, D22).
- A provider-hosted payment-method update (Stripe customer portal) next to "Pay now".
- An admin screen for the nonprofit flag (the command exists).
- Per-meter quotas shown against usage (M3.5a's messaging quotas still apply as before).
