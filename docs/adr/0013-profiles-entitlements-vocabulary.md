# ADR 0013 — Profiles, entitlements, vocabulary; plans dormant until M6.6

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §4.5)

## Context
- One platform serves weddings, galas, concerts, conferences, community events and agencies. Each needs different navigation and words.
- The owner decided to keep the per-ticket fee model at launch, with plans and entitlements modeled from day one and switched on later (M6.6).

## Decision
- **Profiles** live in the typed registry `platform/entitlements/profiles/*`: wedding, gala, concert, conference, community, agency, other.
- Each profile declares default modules, navigation, vocabulary overlay, settings, onboarding checklist, readiness rules, dashboard layouts, alert rules and role presets.
- Orgs have a default profile; **each event has its own profile**.
- **Entitlements** (`billing` module): `plans`, `plan_prices`, `billing_accounts`, `platform_fee_schedules`, `org_module_entitlements`, `entitlement_overrides`, `usage_events`, `usage_counters`.
- **At launch:** every org is on `launch_standard`, which grants all modules in use today. Fee schedules reproduce today's model. Each order snapshots its fee schedule.
- **Resolution:**
  - `effective(org) = (plan ∪ overrides) − suspensions` (Redis 60 s, busted on write)
  - `moduleActive(event, key) = effective(org).has(key) ∧ event_modules[event, key].enabled`
- Three separate states: **entitled** (commercial), **enabled** (organizer choice), **visible** (permissions).
- **Code checks module keys, never plan or profile names.**
- **Vocabulary:** base locale → profile overlay → tenant `translation_overrides`.

## Alternatives
- **Separate products per vertical.** Rejected: one codebase, one module pattern.
- **Plan checks in feature code.** Rejected: pricing changes would need code changes.

## Consequences
- Entitlements are consulted by nav and route guards, `defineCommand`, `/v1` middleware (403 `module_not_enabled`), widgets, alerts, readiness rules, the webhook catalog, `/v1/mobile/config`, journeys and quotas.
- A downgrade locks a module read-only; data is never deleted.
- M0.6 acceptance: revoking an entitlement hides the nav item and returns 403 with no deploy.
- A lint rule flags hard-coded term words.
- Subscriptions switch on in M6.6 with no feature-code changes; tiers are open decision D22.

## Revisit when
- M6.6 (subscriptions go live).
- A new vertical needs a profile the registry cannot express.
