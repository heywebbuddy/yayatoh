# Business continuity and disaster recovery policy

**Status: draft, pending owner.** SOC 2: CC9.1, CC7.5, A1.2, A1.3.

## Objectives (roadmap §10)
| Scope | RPO | RTO |
|---|---|---|
| Checkout and check-in | ≤ 5 min | ≤ 1 h (scanners keep working offline on event day) |
| Everything else | 1 h | 4 h |

## Measures
1. **Backups**: Neon point-in-time restore (7 days) plus nightly encrypted off-account dumps
   (`tools/ops/offsite-dump.sh`) in a separate account with Object Lock. The decryption key is
   held offline by the owner.
2. **Drills**: a monthly restore drill ([restore-drill.md](../../docs/runbooks/restore-drill.md),
   `tools/ops/restore-drill.sh`) and a check-in drill before large events
   ([checkin-drill.md](../../docs/runbooks/checkin-drill.md)). Each drill is recorded.
3. **Event-day resilience**: the Scan PWA works offline with a signed manifest; first-wins sync.
4. **Deploy safety**: [deploy.md](../../docs/runbooks/deploy.md) and
   [rollback.md](../../docs/runbooks/rollback.md).
5. **People**: the contracted backup can run every runbook; credentials for recovery are in the
   owner's password manager with a sealed paper copy.
6. **Vendor outage**: providers sit behind ports; the incident runbook lists the pre-authorized
   degradations (pause checkout, force offline scanning, pause messaging).

This plan is tested at least yearly with a tabletop exercise and after any SEV1.

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
