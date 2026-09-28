# M1.8 — Attendees, guest lists, distribution, bulk actions and search

Roadmap: M1.8. This milestone is delivered in increments:

| # | Increment | Scope | Risk tags |
|---|---|---|---|
| a | Filters, labels, org-wide search | this document | auth (new permission), db-migration (check constraint) |
| b | Bulk-action framework and exports as jobs | ids or filter, registry, progress, partial failures, undo window, audit; CSV export job | db-migration |
| c | Import pipeline | map, preview, job, failure report, undo; 5k rows ≤60 s, ≥97% accepted | db-migration |
| d | Distribution and self-service | claim links, association tags, email (SMS/WhatsApp behind ports), revoke; magic-link attendee self-service; a claimed ticket's old QR is rejected | auth, db-migration |
| e | Guest lists and the contact timeline | guest lists with bulk email; contact timeline v1 | — |
| f | Bulk seats and tickets, the last filters, group blocks, faster search | bulk seat assignment with undo; resend and cancel tickets; ticket-type and check-in filters; group seat blocks; trigram search | db-migration, tenancy (definer search functions), payments-adjacent (cancel without refund) |

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
- Ticket-type and checked-in filters need data from higher tiers (ticketing, check-in). The export already carries both columns; list filters on them come with the `reports` module's list queries (M1.12). **Done in M1.8f** (`reports.attendeeList`).
- Search uses `ILIKE`. A trigram index (`pg_trgm`) is added when real data volumes need it (M1.14 performance pass). **Done in M1.8f** (indexes plus org-scoped search functions, same results).

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

## M1.8e — guest lists, bulk email and the contact timeline (done)
- **Guest list:** `attendees.addGuest` (`attendees:write`) adds one person without a ticket (source `guest`), with optional labels. There is one active entry per email per event, compared case-insensitively.
  - `attendees.removeGuest` sets `cancelled`. The record stays for history, and the person can be added again.
  - Ticket holders leave the list by cancelling their ticket (M1.6), not here.
- **Bulk email** (`attendees.email`, a bulk action):
  - Organizers email the selected attendees, or everyone matching the list filters, with a subject and a plain-text message about the event.
  - Each chunk emits `attendees.message_batch@1` with the operation id and attendee ids. The worker's `attendees.message-mailer` sends one email per active attendee, reading the subject and body from the operation.
  - Each email has its own idempotency key (`attendee-message:<op>:<attendee>`), and the consumer is exactly-once through `processed_events`, so a replayed event never resends.
  - Removed people fail as `not_attending`.
  - These are operational messages about an event people are on the list for, not marketing: marketing consent isn't required. Campaigns and marketing consent enforcement come with M3.6.
- **Bulk framework:** chunk runs can now emit outbox events (`meta.emit`, committed with the chunk). `bulkOperationParamsTx` lets subscribers read an operation's params.
- **Contact timeline v1** (`reports.contactTimeline`, `contacts:read`): one person across this org's events. It shows how they got on each list (ticket, guest list, import…), their orders (total and status), their check-ins, and removals, newest first. It is shown as **History** in the attendee profile.
- **Console:** "Add attendee" opens the guest form. The bulk form gains **Send email**; the subject and message fields appear only for that action.

### Acceptance (M1.8e)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Guests are added by hand, one active entry per email (case-insensitive); removal keeps history and allows re-adding; viewers can't add; ticket holders can't be removed here | `packages/testing/tests/guests.int.test.ts` |
| AC2 | Bulk email: one email per active attendee, removed people skipped with a reason, a replayed batch sends nothing | `guests.int.test.ts` |
| AC3 | The timeline spans events (ticket, order, check-in, guest list), newest first; viewers are forbidden; org B gets `not_found` | `guests.int.test.ts` |
| AC4 | In the console: add two guests (a duplicate is refused), email everyone matching, see History, remove one; axe passes | `apps/web/e2e/guests.spec.ts` |

## M1.8f — bulk seat assignment, bulk ticket actions, the last filters, group blocks and faster search (done)
- **Bulk framework additions** (`@yayatoh/platform`):
  - An item can succeed with a caveat (`BulkItemResult.warning`, stored as the code of a successful item). `BulkOperationDto.warnings` lists the first 50, next to `failures`.
  - `auditParams(params)` lets an action say what of its params the `bulk.start` audit row records (never message bodies).
  - A bulk action's `category` (M1.2e: `money` | `export` | `delete`; actions with a `file` default to `export`) makes the pipeline refuse starting it while platform staff act as a member. Cancel tickets is `delete`.
- **Bulk seat assignment** (`seating.bulkAssign`, `events:write`, 100 per chunk, undo within 10 minutes):
  - Seats the selected attendees, or everyone matching the list's filters. The target can be a table or row, a section, the best available seats of the whole plan, or a group's block.
  - Seats are taken in plan order: items in drawing order, seats in their item's order, accessible seats last.
  - People already seated in the target stay where they are. For "best available", anyone already seated stays. People seated elsewhere move.
  - Partial failures are reported per person: `not_enough_seats`, `seated_by_ticket`, `attendee_cancelled`, `not_found`.
  - Seating rules (M1.7f): while accessible seats are kept back, each placement in one is a warning (`ada_kept_back`). An enforced rule keeps them out of reach unless the organizer ticks the override, which is recorded in the `bulk.start` audit row.
  - Seats change through the same statements as one-by-one assignment (blocked `assigned`, with `prior_block` remembered), so the M1.7f live feed publishes every chunk.
  - Undo unseats everyone still in the seat the operation gave them. It then puts each person back in their previous seat, with its pinned flag and its channel, accessibility or group block, if that seat is still free. Anyone moved since is left alone (`planUndo`).
  - The pure planning (`planChunk`, `planUndo`) is unit-tested.
- **Group seat blocks** (M1.8d's "association tags" for seating):
  - A group is an attendee label, for example a company. `seating.allocateGroup` (`events:write`) keeps the next free seats of a table or row for the group. It takes every free seat there, or a given number. The seats become `blocked` with the new reason `group`, and the name goes in `event_seats.group_label`. Asking for more seats than are free refuses the whole request with `not_enough_seats` and how many would fit.
  - "Seat the group" runs a bulk assignment. It selects everyone active with the label and targets the block, and its progress shows on the attendee list filtered to the group.
  - `seating.releaseGroup` gives the unused seats back to sale.
  - A seated member keeps the label on their seat, so unseating them returns the seat to the group rather than to sale.
  - Unblocking a group seat by hand frees it and clears the label.
  - `seating.groups` lists each group's seats, how many are seated and unused, and its tables and rows. Viewers can read it.
- **Resend tickets** (`ticketing.resendTickets`, `attendees:write`, 200 per chunk):
  - Each chunk emits `ticket.resend_requested@1` with the operation and ticket ids.
  - The worker's `ticketing.resend-mailer` sends one email per still-active ticket to its holder (new kind `ticketing.tickets-resent`, all 13 locales). Each email carries a fresh holder link to "My tickets". The public 3-per-hour limit doesn't apply, because the organizer asked.
  - The dedupe key is `ticket-resend:{operation}:{ticket}`, and the consumer is exactly-once, so a replay sends nothing. A new operation is a new resend.
  - Guests without a ticket fail `no_ticket`. Void tickets fail `ticket_void`.
- **Cancel tickets without a refund** (`orders.cancelTickets`, 100 per chunk, not undoable):
  - Voids the tickets with reason `cancelled`. Scanners reject them.
  - Cancels the attendees and returns the places to inventory.
  - Frees a bought seat (`voidSeatTx`) and any seat the organizer gave the holder.
  - Emits `tickets.cancelled@1`. The `ticketing.cancelled-mailer` tells each holder once (`ticket-cancelled:{ticket}`, new kind `ticketing.ticket-cancelled`).
  - No money moves: orders keep their status and payments. Refunds stay per order (M1.6).
  - The console asks first, in a dialog that names how many people are covered ("Cancel the tickets of 3 people?"). The server re-checks the count against the actual selection and refuses (`invalid_state`) if it changed.
  - **Pending the owner:** the permission is `orders:refund` (owner, admin, finance), on the grounds that voiding paid tickets is as consequential as refunding them. Managers can't cancel.
- **Attendee list filters** (`reports.attendeeList`, `attendees:read`):
  - Adds ticket type (any of) and check-in: today (the event's calendar day in its time zone), any day, or never. People without a ticket count as never.
  - Both run on the server and combine with search, labels, source and status.
  - They are built as ticket-id subqueries over ticketing's and check-in's own tables (`ticketIdsOfTypesSql`, `admittedTicketIdsSql`). The attendees module takes them as a `TicketFilterExtension`, so it never reads a higher tier's schema.
  - Exports take the full filter (`AttendeeListFilter`).
  - Actions of lower tiers resolve "everything matching" to ids through `reports.matchingAttendeeIds`, so labels, email, seats and resend follow the same filters.
  - After a bulk action the list comes back with its filters.
- **Search** (migration 0055_smiling_microchip):
  - `pg_trgm` in a new `extensions` schema, with GIN trigram indexes on attendee name and email and on order buyer name and email.
  - Under row-level security Postgres never uses an index for `ILIKE`, because the operator isn't LEAKPROOF and may not run before the tenant policy.
  - So `attendees.search_ids(pattern)` and `orders.search_ids(pattern)` (SECURITY DEFINER, `search_path = pg_catalog`, EXECUTE for `app_user` only) run the same `ILIKE` for the caller's own org and return ids. They read the org from the `app.org_id` setting the policy reads, and return nothing when it is unset.
  - The list, `attendees.search` and `orders.search` keep their queries under RLS and add `id IN (those ids)`. The results are identical to the plain `ILIKE`, with wildcards still literal.
  - `CREATE INDEX CONCURRENTLY` isn't possible here: drizzle's migrator applies migrations in one transaction. The migration uses `IF NOT EXISTS`, so on a large production table the owner's runbook creates the four indexes `CONCURRENTLY` first under the same names, and the migration then does nothing.
  - **Perf note** (local, Postgres 18, 200,000 attendees in two orgs, 100,000 in the searched org):
    - A plain `ILIKE '%…%'` under RLS takes 130–340 ms (parallel sequential scan).
    - Through `search_ids` it takes 3.4 ms for a rare 5-character string and 20 ms for `guest12345`, a string with many trigram hits.
    - Result counts are identical.
    - Two-character searches can't use trigrams and cost the same as before.
- **Migrations:**
  - 0055_smiling_microchip (0050 + 0051 on the branch, combined at merge) adds `event_seats.group_label`, a partial index `(org_id, event_id, group_label)`, and the check `event_seats_group_check`. It widens `event_seats_block_check` (+ `group`) and `seat_assignments_prior_block_check` (+ `group`); all three constraints go on `NOT VALID` and are then validated.
  - The same migration adds pg_trgm, the four trigram indexes and the two search functions.
  - Both are hand-edited (see the files' `hand-written` blocks). There are no new tables.
- **Console:**
  - The attendee list gets **Ticket type** and **Check-in** filters.
  - The bulk form gets **Assign seats** (where to seat them, plus the accessible-seat override when an enforced rule applies), **Resend tickets** and **Cancel tickets (no refund)** with its confirmation dialog.
  - The progress panel gains a progress bar, done messages per action, failures by reason and warnings.
  - The seating **Assign guests** page gets **Group blocks**: the list, keep seats for a group (with messages for each field), seat the group, and release unused seats.

### Acceptance (M1.8f)
| ID | Criterion | Test |
|---|---|---|
| AC1 | **Assigning 1,000 seats in bulk shows progress, and undo restores it** (progress after the first chunk; all 1,000 seated in plan order; undo restores every previous seat exactly, pinned and all; about 1.1 s to assign and 0.8 s to undo locally) | `packages/testing/tests/bulk-seats.int.test.ts` |
| AC2 | Partial failures per person (not enough seats, seated by ticket, cancelled); seats go off sale on the live feed; undo frees them | `bulk-seats.int.test.ts` |
| AC3 | Seating rules: warn → used last and flagged; enforced → skipped; override → used, flagged and audited | `bulk-seats.int.test.ts` |
| AC4 | Group blocks: allocate (normalized label, off sale live, too many refused), seat members by label, release unused, an unseated member's seat returns to the group; undo restores a group seat and a pinned seat exactly | `bulk-seats.int.test.ts` |
| AC5 | Viewers can't bulk-seat, allocate or release; org B can't seat, allocate, read or undo in org A's event | `bulk-seats.int.test.ts` |
| AC6 | Chunk planning (plan order, accessible last, enforced skip, partial failures) and the undo mapping | `packages/modules/seating/tests/bulk-assign.test.ts` |
| AC7 | Resend: one email per ticket and operation, guests `no_ticket`, a replay (or a re-run handler) sends nothing more; viewers forbidden; org B refused | `packages/testing/tests/bulk-tickets.int.test.ts` |
| AC8 | Cancel: tickets void (`cancelled`), bought and given seats freed, places back in inventory, attendees cancelled, orders still paid with no refund, holders told once, audited, not undoable, a cancelled code doesn't scan; viewers forbidden; org B refused | `bulk-tickets.int.test.ts` |
| AC9 | Filters: ticket type, check-in today (event day) / any / never, combined with the others, paged; "everything matching" and exports follow them; org B sees nothing | `bulk-tickets.int.test.ts` |
| AC10 | Search: the trigram indexes exist and are valid; results are identical to a plain ILIKE (wildcards literal); the search functions are org-scoped and served by the index | `bulk-tickets.int.test.ts`, `attendees.int.test.ts` |
| AC11 | New email kinds render in 13 locales | `packages/modules/notifications/tests/render.test.ts` |
| AC12 | In the console, keyboard only: seat everyone matching at a table, see the progress bar and the person who didn't fit, reload, undo; an empty selection is refused; axe passes | `apps/web/e2e/bulk-actions.spec.ts` |
| AC13 | Resend: 2 sent, the guest reported; no undo; axe passes | `bulk-actions.spec.ts` |
| AC14 | Cancel: nothing selected is refused; the dialog names the count; Escape and "Keep the tickets" change nothing; confirming cancels one, persisted after reload; a cancelled ticket doesn't admit at the door; axe passes | `bulk-actions.spec.ts` |
| AC15 | Filters: ticket type, check-in, combined, kept after reload, empty state, export and labels of everything matching follow them; axe passes | `bulk-actions.spec.ts` |
| AC16 | Group blocks: every validation message, keep 3 seats by keyboard, persisted, seat the group (progress on the list), release the unused seat; axe passes | `bulk-actions.spec.ts` |
| AC17 | Viewers: no bulk form, checkboxes or group form (they can still filter); stale owner pages are refused on the server for both bulk seats and groups | `bulk-actions.spec.ts` |
| AC18 | Arabic RTL: filters, bulk actions, the cancel review and group blocks render right to left; axe passes | `bulk-actions.spec.ts` |

### Later / not yet (M1.8f)
- The impersonation guard (M1.2e) refuses cancel tickets (`category: 'delete'`); covered by `packages/testing/tests/impersonation.int.test.ts`.
- A seat column in the attendee list (the list still shows "—"). The seating views show who sits where.
- Bulk ticket actions from the /v1 API (console only for now).
- Very large plans: bulk seat assignment re-reads and locks the target's seats for each chunk. That is fast at the tested 1,000 seats, but a per-operation seat cursor would scale further for 20,000-seat plans.

### M1.8 status
- All roadmap items are done except the owner-gated delivery channels: SMS and WhatsApp, and real email through SES, both waiting on M1.10 accounts.
- Acceptance: the 5,000-row import is well under 60 s with ≥97% accepted (M1.8c). Assigning 1,000 seats in bulk shows progress and undo restores it (M1.8f). A claimed ticket's old QR is rejected (M1.8d).
