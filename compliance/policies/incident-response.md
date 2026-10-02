# Incident response policy

**Status: draft, pending owner.** SOC 2: CC2.2, CC2.3, CC7.3–CC7.5.

The procedure is [docs/runbooks/incident.md](../../docs/runbooks/incident.md) (NIST SP 800-61r3).
This policy sets the commitments the runbook implements.

1. **Severity** SEV1–SEV3 as defined in the runbook; a cross-tenant exposure, a credential
   compromise or a broken audit chain is always SEV1.
2. **On call**: the owner is primary; a contracted backup covers nights and absences.
3. **Communication**: status page within 15 min (SEV1) or 30 min (SEV2); customers are not named.
4. **Personal data breaches**: the 72-hour GDPR clock starts when exposure is reasonably certain.
   As processor, Yayatoh notifies affected organizers without undue delay; the owner and counsel
   decide on direct notifications.
5. **Leaked secrets** are rotated per [key-rotation.md](../../docs/runbooks/key-rotation.md).
6. **Recovery** per [rollback.md](../../docs/runbooks/rollback.md),
   [restore-drill.md](../../docs/runbooks/restore-drill.md) and
   [webhook-replay.md](../../docs/runbooks/webhook-replay.md).
7. **Post-incident review** within 72 h for SEV1/SEV2, and a PR updating the runbook used.
8. Incident records are kept 7 years.

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
