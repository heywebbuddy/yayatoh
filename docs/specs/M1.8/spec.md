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
- Ticket-type and checked-in filters need data from higher tiers (ticketing, check-in). The export already carries both columns; list filters on them come with the `reports` module's list queries (M1.12).
- Search uses `ILIKE`. A trigram index (`pg_trgm`) is added when real data volumes need it (M1.14 performance pass).

## M1.8b — bulk-action framework and exports as jobs (done)
- **Framework** (`@yayatoh/platform`, tier 0): `defineBulkAction` + `bulkCommands(action)` give each action its own start, undo, status and file commands, with the action's own permission and entitlement.
  - **Selection:** explicit ids (checked against the event: a foreign or unknown id refuses the whole request) or "everything matching" the list's filter. It is resolved once at request time and snapshotted into `platform.bulk_operations.item_ids` (at most 50,000).
  - **Chunks:** `platform.bulkStep` runs one chunk per tenant transaction. It takes the row lock with `FOR UPDATE SKIP LOCKED`, so two runners never work the same operation. The operation keeps counts (processed, succeeded, failed), and per-item failures are stored with stable codes.
  - **Who runs it:** the step command needs `platform:bulk.run`, so only the system runner can call it, never a user. `runBulkOperation` drives an operation for a time budget. A crash marks it `failed` (with a code, never SQL) rather than retrying forever.
  - **Undo window:** an action may define `undo` and `undoWindowMs`. Its items then keep their previous state (`bulk_operation_items.undo`), and `undo` restores them in chunks. Undo works once, only while the window is open.
  - **Files:** exports append each chunk to `platform.files` / `file_parts`, kept in Postgres until R2 exists. Files expire after 7 days.
  - **Audit and events:** `bulk.start` and `bulk.undo` are audited. The outbox carries `bulk.requested@1`, `bulk.completed@1` and `bulk.undone@1`.
- **Who drives operations:** the web app runs each new operation inline for up to 3 s, so small jobs are done when the page reloads. The worker's leader runs anything unfinished every 2 s. It finds due operations across orgs through `platform.due_bulk_operations` (SECURITY DEFINER, audited platform reader) and works each under its own org's RLS.
- **Actions:**
  - **`attendees.label`** adds or removes a label on up to 50k attendees, 500 per chunk. Attendees who would exceed 20 labels fail as `too_many_labels`. Undo within 10 minutes restores every attendee's previous labels.
  - **`reports.attendeesCsv`** (new `reports` module, tier 5, and new permission `attendees:export` for owner, admin, manager and event manager). It writes a CSV with an allowlist of columns: name, email, ticket type, ticket code, serial, source, status, labels, registration time (in the event's timezone), checked in. Headers and yes/no are in the requester's language, and a UTF-8 BOM makes Excel read it correctly. Cells that start with `= + - @` are neutralised against CSV injection. The download route checks the session's role and that the operation belongs to this event, and sends `no-store`.
- **Console:** attendee rows get checkboxes. The bulk form applies to "Selected" or "All N matching" the current filters, and offers add label, remove label or export. A progress panel refreshes every 2 s while the operation runs, and shows failures by reason, **Undo** and **Download CSV**.

### Acceptance (M1.8b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Labels by ids: partial failures are reported per item with a code; undo restores; undo is one-shot | `packages/testing/tests/bulk.int.test.ts` |
| AC2 | The undo window closes after 10 minutes | `bulk.int.test.ts` |
| AC3 | 2,000 attendees by filter: progress is visible between chunks; all labeled; undo restores all (well under 20 s) | `bulk.int.test.ts` |
| AC4 | CSV: localized headers, event-time stamps, check-in state, quoting, formula neutralisation, no contact ids | `bulk.int.test.ts` |
| AC5 | Viewers can't label or export; users can't run steps; foreign ids and empty selections are refused | `bulk.int.test.ts` |
| AC6 | Org B can't see, undo, run or download org A operations; the isolation suite covers the four new tables | `bulk.int.test.ts`, isolation suite |
| AC7 | The worker finds unfinished operations across orgs through the audited reader and finishes each | `apps/worker/tests/bulk.int.test.ts` |
| AC8 | In the console: label two selected guests, undo, export all matching, download the CSV; an anonymous request gets no file; axe passes | `apps/web/e2e/attendees.spec.ts` |

### Not yet (M1.8b)
- Bulk ticket actions (resend, cancel), bulk email and "assign seats" arrive with their features (M1.8d/e, M1.7), as new actions on this framework.
- Export files live in Postgres until the owner's R2 account exists (owner inbox: Cloudflare account).

## M1.8c — guest-list import (done)
- **Upload** (`attendees.stageImport`, `attendees:write`): a CSV of ≤5 MB, ≤20,000 rows and ≤50 columns.
  - The new universal `@yayatoh/csv` package parses it: RFC 4180 quoting and embedded newlines, CRLF or LF, a BOM, and a comma, semicolon or tab delimiter sniffed from the header.
  - Unreadable files get a reason (unclosed quote, too many rows, …) and nothing is stored.
  - Rows are staged in `attendees.import_rows` under an `import_batches` row. Nothing touches the guest list yet.
- **Mapping and checks** (`attendees.validateImport`):
  - Name, email and labels are mapped to columns. The mapping is guessed from headers in several languages, and the organizer can change it.
  - An optional label can be added to everyone. A nameless row falls back to its email's local part.
  - Every row gets a reason or none: `missing_email`, `invalid_email`, `invalid_label`, `too_many_labels`, `duplicate_in_file` (the first occurrence wins), `already_on_list` (an active attendee at the event with that email, case-insensitive).
  - A file that has already been imported can't be re-mapped.
- **Preview:** counts by reason plus the first 10 rows as they will be imported.
- **Import job:** `attendees.import`, an action on the M1.8b bulk framework, 500 rows per chunk.
  - Each chunk creates or reuses contacts in one statement (`crm.upsertContactsTx`), then inserts the attendees (source `import`) with ids assigned up front. Each staged row links to its attendee.
  - A row whose email reached the list after the check fails as `already_on_list`.
  - **Undo** within 10 minutes deletes exactly the attendees this import created. Contacts stay, deduplicated by email.
- **Failure report:** the organizer's own columns plus a "Problem" column in their language, for the rows that were not imported, ready to fix and upload again.
- **Console:** Attendees → **Import** → upload → match columns → check rows → **Import N guests**. It lands on the attendee list with the progress panel and Undo.
- **Migration 0023:** `import_batches` and `import_rows`, with FORCE RLS, composite FKs (event, batch, and attendee with `ON DELETE SET NULL (attendee_id)`) and fixture rows for both orgs.

### Acceptance (M1.8c)
| ID | Criterion | Test |
|---|---|---|
| AC1 | **5,000 rows (2% invalid) are staged, checked and imported in <60 s** (about 2.5 s locally) **with ≥97% accepted**; one contact per email | `packages/testing/tests/imports.int.test.ts` |
| AC2 | A reason for each bad row; preview after mapping; the extra label and the name fallback apply | `imports.int.test.ts` |
| AC3 | The failure report has the original columns plus the localized reason, bad rows only; re-mapping after import is refused; undo removes exactly the imported guests | `imports.int.test.ts` |
| AC4 | Unreadable files → `validation_failed` with a reason; viewers → `forbidden`; importing before checking → `invalid_state` | `imports.int.test.ts` |
| AC5 | Org B can't read, validate, import or stage into org A's files and events | `imports.int.test.ts`, isolation suite |
| AC6 | In the console: upload → map → check (one problem shown, report downloadable) → import 2 → labels applied → undo; axe passes | `apps/web/e2e/attendees.spec.ts` |

### Not yet (M1.8c)
- Import from XLSX (convert to CSV for now), custom fields and question answers per column arrive with registration forms (M5.1). Legacy guest-list migration uses the ELT pipeline (Phase 2), not this importer.

## M1.8d — distribution (claim links) and holder self-service (done)
- **Link tokens** (`@yayatoh/platform` `signLinkToken` / `verifyLinkToken`):
  - A token is `<row id>~HMAC-SHA256(purpose:id)` under `APP_TOKEN_SECRET`, bound to its purpose (`ticket-claim`, `ticket-holder`) and compared in constant time.
  - Nothing secret is stored: the row's state decides whether the link still works.
  - SECURITY DEFINER `ticketing.claim_org` / `ticketing.holder_link_org` resolve the id to its org before any tenant is known (active orgs only).
- **Claim links** (`ticketing.ticket_claims`):
  - An organizer (`attendees:write`) creates a link for up to 100 tickets of one event, optionally emailed via the `ticket.claim_link_created@1` event and its mailer.
  - The token is shown once. At most one open link per ticket (partial unique): a new one revokes the old. Links can be revoked and expire (30 days by default).
  - **Claiming** (public; name + email) reissues the ticket via `reissueTicketTx`:
    - rev + 1 with a freshly signed code; older codes deactivate
    - a new short code, so the old printed one stops working too
    - the holder fields change, and the ticket's attendee moves to the new person
  - It emits `ticket.claimed@1`. The claimant lands on their tickets straight away through a holder link.
  - The buyer's order page and PDF stop showing passed-on tickets and their codes. They only say how many were passed on.
  - Offline scanners drop a reissued ticket's old short code when the manifest syncs.
- **Holder self-service** (`ticketing.holder_links`, 7 days):
  - "Already have tickets?" on the public event page emails a magic link (`ticket.holder_link_created@1`).
  - The answer never reveals whether the email has tickets, and requests are limited to 3 per email per event per hour.
  - The **My tickets** page shows the holder's active tickets for the event, with QR, short code and holder. Holders can **pass a ticket on** with a new claim link; it stays theirs until claimed.
- **Console:** the attendee profile has "Send this ticket" (optional email; the link is shown once to copy), plus the open link's state and Revoke.
- **Migration 0024:** the two tables (FORCE RLS, composite FKs to tickets and events), the two definer functions, and fixture rows for both orgs.

### Acceptance (M1.8d)
| ID | Criterion | Test |
|---|---|---|
| AC1 | **A claimed ticket's old QR is rejected**, and its old short code too; the claimant's new code admits; the attendee is the claimant | `packages/testing/tests/distribution.int.test.ts`, `apps/web/e2e/distribution.spec.ts` |
| AC2 | The buyer's order page no longer shows the passed-on ticket or its new code, only how many were passed on | `distribution.int.test.ts`, `distribution.spec.ts` |
| AC3 | Holders pass a ticket on from their magic link; it leaves their list once claimed; they can't give away others' tickets | `distribution.int.test.ts` |
| AC4 | Links work once; replaced, revoked and expired links are refused with their state | `distribution.int.test.ts` |
| AC5 | Holder-link requests don't enumerate emails and are rate-limited; tokens are purpose-bound and tamper-evident | `distribution.int.test.ts`, `packages/platform/tests/tokens.test.ts` |
| AC6 | Viewers can't create links; org B can't create links for, or read, org A's claims | `distribution.int.test.ts`, isolation suite |

### Not yet (M1.8d)
- SMS and WhatsApp delivery of links go through the messaging ports in M1.10 (Twilio is an owner account, see the owner inbox). Email uses the console mailer until SES exists.
- Association tags (batches of tickets for a company or group) use attendee labels today; allocating seats to a group comes with seating (M1.7).
