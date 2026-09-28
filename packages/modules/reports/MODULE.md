# reports (tier 5)

Exports and (from M1.12) reports that read across modules. Owns no tables: it reads other
modules only through their exported functions and writes files through the platform bulk
framework.

**Invariants**
- Every export is an allowlist of columns. Contact ids, tokens, answers marked sensitive and payment data never leave.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'`, so spreadsheet apps don't run them as formulas (CSV injection).
- Exports run as bulk operations: the selection is snapshotted, progress is visible, and the file expires after 7 days.
- Starting an export needs a recent step-up (bulk actions with a file default to `stepUp`, M1.2c).
- Times are rendered in the event's timezone.
- Every number a report, dashboard or export shows comes from the metric registry (`src/metrics/registry.ts`): one definition per key, each value stamped with `asOf`. Money is per currency and never summed across currencies.
- Reports read other modules only through their exported read functions (`*FactsTx`, `salesBy*Tx`, …) inside the caller's tenant transaction; they never import another module's schema.
- Finance figures (platform fees, disputes, net revenue) need `finance:read`; sales and counts need `orders:read`.
- **Attendee list (M1.8f):** `reports.attendeeList` adds ticket-type and check-in (today in the event's time zone / any day / never) filters to the attendees module's own, as subqueries from ticketing and check-in. Exports and "everything matching" selections (`reports.matchingAttendeeIds`) use the same filter.
