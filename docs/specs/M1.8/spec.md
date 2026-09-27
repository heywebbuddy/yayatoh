# M1.8 — Attendees, guest lists, distribution, bulk actions and search

Roadmap: M1.8. This milestone is delivered in increments:

| # | Increment | Scope | Risk tags |
|---|---|---|---|
| a | Filters, labels, org-wide search | this document | auth (new permission), db-migration (check constraint) |
| b | Bulk-action framework and exports as jobs | ids or filter, registry, progress, partial failures, undo window, audit; CSV export job | db-migration |
| c | Import pipeline | map, preview, job, failure report, undo; 5k rows ≤60 s, ≥97% accepted | db-migration |
| d | Distribution and self-service | claim links, association tags, email (SMS/WhatsApp behind ports), revoke; magic-link attendee self-service; a claimed ticket's old QR is rejected | auth, db-migration |
| e | Guest lists and the contact timeline | guest lists with bulk email; contact timeline v1 | — |

## M1.8a — filters, labels and org-wide search (done)
- **Attendee list** (`attendees.listAttendees`), filtered on the server:
  - text search (name or email, LIKE wildcards literal)
  - labels (any of)
  - source (ticket, registration, guest list, import, complimentary)
  - status
  - offset paging (50 per page in the console)
- **Labels:**
  - free text, trimmed with whitespace collapsed, 1–40 characters, at most 20 per attendee (a check constraint too; migration 0021 adds it `NOT VALID` + `VALIDATE`).
  - `attendees.setLabels` adds/removes labels on up to 500 attendees of one event in one statement. Removal wins over addition. Exceeding 20 refuses the whole change. It's audited. Bulk labeling in the UI arrives with the bulk-action framework (M1.8b).
  - `attendees.labels` lists an event's labels with counts for the filter chips.
- **New permission `attendees:write`:** owner, admin, manager, box office, and the event-scoped `event_manager`. Viewers can read but not label.
- **Org-wide search** (the console header field; ⌘K / Ctrl+K or "/" focuses it) at `/o/{org}/search?q=`:
  - events by name
  - people by name or email (`attendees.search`)
  - orders by buyer name, email or order-id prefix (`orders.search`)
  - tickets by their 8-character code or a scanned yy1 code (`ticketing.findByCode`, signature-verified), resolved to their attendee
  - Each group appears only for roles that can read it. Every query runs under the org's RLS and returns an allowlisted hit DTO (no contact ids, no tokens).
  - Results link into the event's attendee list with the profile open; the profile loads by id, so it works beyond the current page.
- **Profile panel:** labels with remove buttons and an add field (suggesting the event's existing labels) for `attendees:write`.

### Acceptance (M1.8a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Bulk labels are normalized and deduplicated; removal wins; the list filters by any-of labels; label counts are right | `packages/testing/tests/attendees.int.test.ts` |
| AC2 | Source/status filters and offset paging cover every row exactly once | `attendees.int.test.ts` |
| AC3 | 20-label cap; unknown attendees → `not_found`; empty change → `validation_failed`; viewers → `forbidden` | `attendees.int.test.ts` |
| AC4 | Search finds attendees by name, orders by email and id prefix, tickets by short code (any case) → attendee; hit DTOs are allowlisted | `attendees.int.test.ts` |
| AC5 | Org B's search finds nothing of org A (attendees, orders, codes) | `attendees.int.test.ts` |
| AC6 | In the console: label a guest, filter by the label, remove it; Ctrl+K focuses search; name, code and email searches land on the right person; axe passes | `apps/web/e2e/attendees.spec.ts` |

### Not yet
- Ticket-type and checked-in filters need data from higher tiers (ticketing, check-in). They come with the bulk/export work (M1.8b), through a query in a tier that can read both.
- Search uses `ILIKE`. A trigram index (`pg_trgm`) is added when real data volumes need it (M1.14 performance pass).
