# Information security policy

**Status: draft, pending owner.** Prepared by Claude Code for M5.11a (P5-6). Not in force until
the owner (Pani Digital Services, LLC) approves and signs it. SOC 2: CC1.1, CC1.3, CC5.3.

## Purpose and scope
Protect the confidentiality, integrity and availability of Yayatoh 2.0 and the data organizers
and attendees entrust to it. Applies to the owner, the contracted on-call backup, contractors,
and every automated build session (Claude Code) that changes the code.

## Roles
| Role | Responsibility |
|---|---|
| Owner | Approves policies, risk-tagged changes, vendors and production actions; primary on call; security contact |
| On-call backup (contractor) | Covers nights and the owner's absences per [incident.md](../../docs/runbooks/incident.md) |
| Build sessions (Claude Code) | Write code, tests, runbooks and evidence under `CLAUDE.md`; never touch production, real accounts or real secrets |
| Platform staff | Use the staff console (`apps/admin`) under the owner-approved staff list (D10); every read is audited |

## Principles
1. **Tenant isolation** by row-level security that the database enforces (ADR 0003).
2. **Least privilege**: roles and permissions per org (ADR 0010); `platform_reader` only in the
   staff console and the worker, every use audited.
3. **Allowlisted output**: nothing leaves the system except through an allowlist serializer (ADR 0014).
4. **No secrets in the repository**; secrets live in Doppler and hosting credentials. gitleaks
   scans every push.
5. **No production data in development**: masked snapshots only (`tools/legacy-mask`).
6. **Every change reviewed and tested**: see [change-management.md](change-management.md).
7. **Encryption**: TLS in transit; sensitive columns encrypted with a KMS-held key (KeyVault).

## Related policies
[access-control.md](access-control.md) · [change-management.md](change-management.md) ·
[incident-response.md](incident-response.md) · [vendor-management.md](vendor-management.md) ·
[data-retention.md](data-retention.md) · [business-continuity.md](business-continuity.md)

## Review
Reviewed at least yearly and after any SEV1 incident. Exceptions need the owner's written approval,
recorded in `docs/decisions.md`.

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
