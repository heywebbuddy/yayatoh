# billing (tier 1)

Plans and entitlements (roadmap §4.5, ADR 0013). Owns Postgres schema `billing`.

**Invariants**
- `billing.plans` and `billing.plan_modules` are global reference data: readable by `app_user`, written only by migrations.
- Every org is on `launch_standard` unless `org_plans` says otherwise (subscriptions stay dormant until M6.6).
- `effective(org) = (plan modules ∪ active grants) − active revokes`.
- Code checks module keys, never plan names.
- Overrides are platform actions (`platform:entitlements.manage`), audited, and take effect without a deploy.
