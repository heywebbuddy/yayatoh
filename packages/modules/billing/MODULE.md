# billing (tier 1)

Plans and entitlements (roadmap §4.5, ADR 0013). Owns Postgres schema `billing`.

**Invariants**
- `billing.plans` and `billing.plan_modules` are global reference data: readable by `app_user`, written only by migrations.
- Every org is on `launch_standard` unless `org_plans` says otherwise. `org_plans` is the plan whose fee schedule applies; a subscription moves it unless the org's legacy fees are grandfathered (M6.6a).
- `effective(org) = (base ∪ active grants) − active revokes`, where base is the plan's modules, or, with billing switched on (`BILLING_ENABLED`) and a live subscription whose entitlements the provider synced, those entitlements plus `core`. With billing off it is exactly the plan modules.
- Code checks module keys, never plan names.
- Overrides are platform actions (`platform:entitlements.manage`), audited, and take effect without a deploy.

**Subscription billing (M6.6a, dormant)**
- Everything that talks to the billing provider goes through `BillingProvider` (fake in dev/CI; Stripe only behind the port, never from tests). `BILLING_ENABLED` unset = off: the webhook is a 404 and modules never read subscription data.
- The plan catalog (`plan_catalog`, `plan_prices`, `features`) is global reference data: migrations seed it and only `billing.apply_catalog` (platform_reader, the worker's catalog sync) writes it. `launch_standard` is never sold or synced.
- Provider webhooks are verified on the raw body, deduplicated by provider event id (`provider_events`) and ordered by the provider's event time; only the system applies them (`billing.applyProviderEvent`).
- The plan page reads only `PlanSummaryDto` (no provider, customer or event ids).
