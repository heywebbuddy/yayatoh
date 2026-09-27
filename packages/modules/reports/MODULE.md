# reports (tier 5)

Exports and (from M1.12) reports that read across modules. Owns no tables: it reads other
modules only through their exported functions and writes files through the platform bulk
framework.

**Invariants**
- Every export is an allowlist of columns. Contact ids, tokens, answers marked sensitive and payment data never leave.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'`, so spreadsheet apps don't run them as formulas (CSV injection).
- Exports run as bulk operations: the selection is snapshotted, progress is visible, and the file expires after 7 days.
- Times are rendered in the event's timezone.
