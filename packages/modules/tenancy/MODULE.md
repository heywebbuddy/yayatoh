# tenancy (tier 1)

Organizations and memberships. Owns Postgres schema `tenancy`.

**Invariants**
- `organizations.org_id = organizations.id` (CHECK). An org row is visible only inside its own tenant context.
- An org always has at least one `owner` membership; the last owner cannot be removed or demoted.
- Slugs are global and immutable once an event is published on them (enforced from M1.4).
- Cross-org reads (slug → id, "my orgs") go only through the SECURITY DEFINER functions
  `tenancy.resolve_org_slug(slug)` and `tenancy.user_memberships(user_id)`, which return allowlisted columns.
- Owner, admin and finance (`TWO_FACTOR_ROLES`) must use two-step verification; `twoFactorRequiredBy(userId)` lists the memberships that require it (M1.2c). The console refuses them until it is on.
- Org status (M1.3f): only platform actors change it (`tenancy.setOrgStatus`); `terminated` is final from the console. Every status change is recorded in `org_status_changes` and emitted as `org.status_changed@1`. `orgStatusGate` (the command pipeline's org gate) makes suspended orgs read-only for members, API keys and the public, and terminated orgs read-only except personal actions and owners' exports.
- Signup (M3.11a): without a code only while the platform switch `open_signup` is on, read inside the signup transaction through `platform.flag_enabled` (app_user never touches `platform.flags`); self-serve orgs start `limited`. A `limited` org can't start guest bulk messaging (`assertNotPausedTx(tx, 'pause_messaging')` → `org_limited`) and becomes `active` only through `tenancy.completeOnboarding` once the required steps are done.
- Onboarding progress (`org_onboarding`, M3.11a) is written only by `markOnboardingStepTx`, inside the transaction of the command that did the step (other modules call it down the tiers); a step's first time is kept.
- Domain changes (add, primary, remove), invitations, role grants/changes/removals and API key creation/revocation are step-up commands (`stepUp: true`).
- **Event teams (M4.2a, P4-8):** `EVENT_ROLE_PERMISSIONS` lists what each event role adds for one event (exact permissions or `module:*` wildcards); `eventRoleCan` never grants `platform:`, `payouts:`, `billing:`, `members:`, `api_keys:`, `audit:`, `privacy:` or `org:` permissions. The `collaborator` org role (only `org:read`) is given only by accepting an event invitation (`invitations.event_id` + `event_role`, same token rules); `GRANTABLE_ORG_ROLES` leaves it out. `EVENT_ROLE_SECTIONS` lists the console sections a team role opens.

**Public surface:** `.` (commands, queries, authorizer, DTOs), `./testing` (fixtures).
- **Venue partners (M6.14b):** a venue adds partner organizers by slug (`venue_partner` in `org_relationships`, parent = venue); removing sets `detached_at`. Names reach the venue only through `tenancy.venue_partners()` (slug and name).
