# Data retention and disposal policy

**Status: draft, pending owner.** Implements decision D11 (full history; 24-month attendee
PII; archive 24 months). SOC 2: C1.1, C1.2, CC6.5.

## Retention periods (roadmap §10 defaults)
| Data | Kept | Then |
|---|---|---|
| Attendee personal data | 24 months after the event | Redacted by the daily retention job |
| Check-in logs | 12 months | Deleted |
| Audit log | 12 months hot + 7 years WORM (S3 Object Lock) | Deleted from WORM after 7 years |
| `platform.access_log` (staff reads) | at least 12 months, purged only after off-account archive | Deleted |
| Payment and ledger records | 7 years | Deleted |
| Abandoned orders | Redacted by the retention pass | — |
| Exports and generated files | 7 days | Deleted |
| Off-account database dumps | 35 daily, 12 monthly | Deleted by bucket lifecycle |
| Wedding guest data | Per D11 until the owner sets a shorter social default | — |

## Disposal
- The daily retention job (`apps/worker/src/retention.ts`) runs per org under that org's RLS.
- DSAR erasure deletes or redacts the person's data, including exports and analytics.
- A terminated org follows [restore-terminated-org.md](../../docs/runbooks/restore-terminated-org.md)
  during its grace period, then its data is deleted except records the law requires us to keep.
- Development and CI never hold production data; masked snapshots are deleted after use.

## Classification
Every text, JSON and array column is classified public, vocabulary, or a private class in its
module's `private-columns.ts`; secrets are never returned; sensitive fields are encrypted.

| Version | Date | Approved by |
|---|---|---|
| 0.1 draft | 2026-09-29 | pending owner |
