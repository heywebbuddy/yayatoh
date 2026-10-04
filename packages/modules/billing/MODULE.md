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

**Meters, plan changes and dunning (M6.6b, dormant)**
- Usage comes only from outbox events (`messaging.usage_metered`, `ai.credits_spent`/`_refunded`, `device.enrolled`); one `usage_records` row per (event, meter), so a replayed event never counts twice. A record is marked reported only after the provider's meter accepted it (its id is the provider's identifier).
- A plan change is recorded (`plan_changes`, Idempotency-Key) and sent to the provider; only the provider's webhook moves the subscription, the fee plan and the modules. A change that turns modules off needs the organizer's confirmation; their data is never touched.
- Dunning never deletes anything. A failed renewal gives a grace period; after it, or once the provider gives up, the org's members and API keys are read-only (`read_only_billing`) until it pays. Buyers, guests, portals, devices and the platform are never refused; reads, exports, paying, changing the plan and door scans always work. With billing off the gate reads nothing.
- The nonprofit coupon comes from a verified charity profile (outbox) or a staff flag (audited); billing never reads the charity module's tables.
