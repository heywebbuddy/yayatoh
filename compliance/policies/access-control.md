# Access control policy

**Status: draft, pending owner.** SOC 2: CC6.1–CC6.3, CC5.3.

## Scope
Production systems (hosting, database, Doppler, Stripe, AWS, email/SMS providers), the GitHub
repository, the staff console (`apps/admin`) and customer org access inside the product.

## Customer (org) access — enforced in code
- Members hold one org role (owner, admin, manager, finance, viewer, and profile-specific roles);
  each role grants listed permissions (ADR 0010). Checked in step 3 of every command.
- Owners and finance must use two-step verification; sensitive actions require recent step-up.
- API keys are scoped, revocable and shown once; sandbox keys never touch live money.
- The tenant comes from the route or the session, never from request headers.

## Platform staff access
- Only people on the owner-approved staff list (D10) get a staff role, granted by the worker CLI
  (`pnpm --filter @yayatoh/worker staff`). Staff get passkeys.
- Staff reads bypass RLS only through `platform_reader`, and every use writes
  `platform.access_log` before it runs. Impersonation is time-boxed and shown in the org's
  Activity log as `impersonatedBy`.

## Infrastructure and repository access
- Accounts are individual and protected by MFA; no shared logins.
- Production write access is limited to the owner and, when on call, the backup.
- Build sessions have no production credentials; the GitHub token in CI is read-only except where
  a workflow states otherwise.
- **Access reviews**: quarterly, the owner reviews GitHub collaborators, Doppler, hosting,
  Stripe and AWS members and the staff list, and records the result
  ([evidence-production.md](../../docs/runbooks/evidence-production.md)).
- **Leavers**: access removed the same day; secrets they could read rotated per
  [key-rotation.md](../../docs/runbooks/key-rotation.md).

## Evidence
Isolation and canary suites on every PR; the weekly evidence bundle's `github/access.json` and
`audit/audit-samples.json`; the owner's quarterly access-review record.

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
