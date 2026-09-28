# tenancy (tier 1)

Organizations and memberships. Owns Postgres schema `tenancy`.

**Invariants**
- `organizations.org_id = organizations.id` (CHECK). An org row is visible only inside its own tenant context.
- An org always has at least one `owner` membership; the last owner cannot be removed or demoted.
- Slugs are global and immutable once an event is published on them (enforced from M1.4).
- Cross-org reads (slug → id, "my orgs") go only through the SECURITY DEFINER functions
  `tenancy.resolve_org_slug(slug)` and `tenancy.user_memberships(user_id)`, which return allowlisted columns.
- Owner, admin and finance (`TWO_FACTOR_ROLES`) must use two-step verification; `twoFactorRequiredBy(userId)` lists the memberships that require it (M1.2c). The console refuses them until it is on.
- Domain changes (add, primary, remove), invitations, role grants/changes/removals and API key creation/revocation are step-up commands (`stepUp: true`).

**Public surface:** `.` (commands, queries, authorizer, DTOs), `./testing` (fixtures).
