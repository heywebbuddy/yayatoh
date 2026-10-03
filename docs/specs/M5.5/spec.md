# Spec: M5.5 — Badges and printing

- **Milestone:** M5.5 (roadmap §10 Phase 5, "M5.5 Badges and printing (M)"; Phase 5 plan `docs/plans/phase-5.md`, Wave 1, decisions P5-1, P5-2, P5-10, P5-11)
- **Status:** M5.5a built (2026-09-29). M5.5b (printers, print log, PrintNode) and M5.5c (kiosk self-print) follow.
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0002, 0003, 0011 (QR format), 0014, 0016, 0017 (PDF engine), 0018 (tokens only)

## M5.5a — badge designer and batch PDF (done)

### 1. Goal and users
Conference organizers design name badges once per event, pick a template per ticket type, and
print every badge as one PDF before the event (sorted the way their volunteers hand them out) or
one badge at the desk. Printing is the PDF itself (P5-2 Stage 1): AirPrint from an iPad or Mac, or
the browser's print dialog, on any printer and badge stock.

### 2. References
- **Vision:** conference nav "Registration | Sessions | Speakers | Exhibitors | Sponsors | Badges | Check-In | Analytics".
- **Roadmap:** M5.5 ("Badge designer; batch PDF; AirPrint, then PrintNode or Zebra; print log; kiosk self-print; printer alerts"); Phase 5 plan acceptance: golden PDFs for 3 templates in English and Arabic; 1,000 badges render in one job under 2 minutes.
- **Legacy evidence:** none (Eventmie Pro prints tickets only).

### 3. Scope
**In (built):**
- New module `@yayatoh/badges` (tier 5, schema `badges`, `MODULE.md`): `templates`, immutable `template_versions` (the `BadgeDesign` JSON), `assignments` (one template per ticket type), `batches` and `batch_parts`. Gated by the `badges` module key; the page exists only where the profile's nav lists it (the conference profile now has **Badges** in its Run group).
- **Designer** (`/o/{org}/e/{event}/badges/{template}`): fields first name, last name, company, job title, ticket type label, QR, ribbon, logo (the org logo) and free text; font size, bold, alignment (start/centre/end, logical), **shrink to fit width**; front and back for fold-over stock. **Keyboard alternative to drag:** every element is a button (Tab or click selects it); arrow keys move it 1 mm (Shift: 5 mm), Alt/Option + arrows resize it; position and size can also be typed in millimetres. Pointer drag works on top. A safe-area warning names elements that could be clipped; the preview draws the safe area and trim.
- **Live preview in English and Arabic** with sample people: the Arabic preview mirrors the layout (x′ = width − x − w), start/end alignment follows the reading side, and the browser shapes the Arabic text; keyboard moves stay visual in the mirrored view. A saved template can also be downloaded as a sample PDF in either language.
- **Sizes (P5-2)** with bleed and safe areas: 4×3 in fold-over (front and back on one 4×6 sheet, the back turned 180°; bleed 3.175 mm), 4×6 in, CR80 card (portrait), Brother QL 62 mm (cut at 100 mm) and Brother QL 4 in (102 × 152 mm). Changing the size rescales the layout. One PDF may mix sizes (named `@page` rules).
- **One template per ticket type**; unassigned types print with the event's **default** (the first template; deleting the default promotes the oldest). Ribbons map ticket type → label + a **token colour pair** (fill + text, each ≥ 4.5:1).
- **Badge QR = the ticket's active signed yy1 code** (`@yayatoh/ticket-crypto`, ADR 0011), unchanged: the Scan PWA reads a badge as the ticket. Voided tickets are not printed.
- **Render allowlist:** `badgeRow` builds a strict `BadgeRow` with only the fields the template places. Ticketing's new `badgeTicketsTx` never selects the holder's email; company and job title come only from a checkout question the organizer maps on the template, and only non-sensitive short-text questions can be mapped (checked on save).
- **Batch PDF:** `badges.startBatch` (`attendees:export`, step-up, category `export`, idempotent per request key) snapshots active tickets (optionally some ticket types), sorts them **A–Z by last name** (particles and Arabic articles ignored, locale collation, then first name, then serial) or **by company** (no company last), and pins the template versions. The worker's pg-boss job **`badges.batch`** (exclusive per batch, queued by the leader tick) renders chunks of 100 through `@yayatoh/pdf` (Gotenberg), stores each chunk, merges them (Gotenberg's PDF engines, new optional `PdfRenderer.merge`) and stores the file in the media store (`{org}/{batch}/0-{sha}.pdf`; the media key check now accepts `.pdf`). The web runs a new batch for 8 s inline, so small batches are ready when the page reloads. **Progress** (bar and "n of N"), **cancel** between chunks, **download** through a signed, 15-minute link (`/api/badges/{org}~{batch}~{exp}~{hmac}`), files kept 7 days.
- **One-badge PDF** for the desk (find a holder by name or ticket number; `attendees:write`).
- Permissions: templates and assignments `events:write`; previews `events:read` (viewers can preview); batches and downloads `attendees:export`; one badge `attendees:write`.
- 13 locales (Arabic plurals zero…other, Russian one/few/many/other), Arabic RTL console, logical CSS, tokens only, strict CSP (positions and ribbon colours set through the CSSOM).

**Later / Not yet:**
- Registration-type bindings (Wave 2 after M5.1a): add `assignments.registration_type_id` (FK, unique) and widen `assignments_target_check` to `num_nonnulls(ticket_type_id, registration_type_id) = 1` (NOT VALID, then VALIDATE).
- Printers, print jobs, print log with reprint reasons, the `BadgePrinter` port and PrintNode (M5.5b); kiosk self-print (M5.5c); the balance-due flag (M5.1d).
- Profile fields for company and job title (registration forms, M5.1b) instead of mapped checkout questions.
- Deleting expired batch files from the media store (a retention sweep) and counting them against the media quota.
- A batch that fails (Gotenberg down after the adapter's retry) is marked failed; the organizer starts a new one. No automatic resume of a failed batch.
- Custom fonts and uploaded background images on badges.

### 4. `touches:`
```yaml
touches:
  - packages/modules/badges/**
  - packages/modules/ticketing/src/{badges,index}.ts
  - packages/modules/media/src/storage/port.ts
  - packages/pdf/src/renderer.ts
  - packages/platform/src/profiles/index.ts
  - packages/platform/tests/profiles.test.ts
  - packages/db/drizzle/0076_true_thunderbolt.sql (+ meta)
  - packages/testing/{package.json,src/fixtures.ts,src/canary/registry.ts,tests/badges.int.test.ts}
  - apps/worker/{package.json,src/badges.ts,src/main.ts,tests/badges.int.test.ts}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/badges/**
  - apps/web/src/app/api/badges/[token]/route.ts
  - apps/web/src/components/{badge-designer,icons}.tsx
  - apps/web/src/server/{badges,badge-pdf}.ts
  - apps/web/messages/*.json
  - apps/web/e2e/badges.spec.ts
  - .github/workflows/ci.yml (Gotenberg service for the integration job)
```

### 5. Data
Migration `0076_true_thunderbolt.sql` (renumbered at merge): schema `badges`, five tenant tables with `org_id`, ENABLE + FORCE RLS and the NULLIF policy, org-leading indexes, composite FKs. Hand-written block: composite FKs to `events.events` (templates, assignments, batches) and `ticketing.ticket_types` (assignments), all `ON DELETE CASCADE`. Every text/jsonb column is declared in `private-columns.ts`; `batch_parts.pdf` (bytea) is personal and never leaves the job.

### 6. Acceptance
| Criterion | Test |
|---|---|
| Layout maths per size (sizes, bleed/safe, RTL mirror, fold-over back, keyboard move/resize clamping, rescale) | `packages/modules/badges/tests/domain.test.ts` |
| Sort orders (last name with particles, company with no-company last, numeric, stable) | `packages/modules/badges/tests/domain.test.ts` |
| Name fitting (fits, shrinks in half points, minimum + clipped, height cap, scripts) | `packages/modules/badges/tests/domain.test.ts` |
| Ribbon mapping and token colour contrast | `packages/modules/badges/tests/domain.test.ts` |
| Render allowlist (unplaced fields blank; unmapped answers, email and sensitive answers never printed) | `packages/modules/badges/tests/domain.test.ts`, `packages/testing/tests/badges.int.test.ts` |
| Golden PDFs: 3 templates in English and Arabic (HTML byte-exact; PDF pages, page sizes, text; Arabic shaped) | `packages/modules/badges/tests/golden.test.ts`, `packages/modules/badges/tests/golden.int.test.ts` |
| 1,000 badges render in one job in under 2 minutes (Gotenberg), 1,000 pages at 4 × 6 in | `packages/testing/tests/badges.int.test.ts` |
| Job idempotent under retries (crash mid-batch, duplicate chunk delivery, two runners) | `packages/testing/tests/badges.int.test.ts` |
| The badge QR is the ticket code and verifies with the event's public key (decoded with the Scan PWA's zxing fallback) | `packages/testing/tests/badges.int.test.ts` |
| pg-boss job: exclusive per batch, leader tick queues it until done, platform access audited | `apps/worker/tests/badges.int.test.ts` |
| Templates: default, unique names, stale save refused, questions and ribbons validated, one per ticket type | `packages/testing/tests/badges.int.test.ts` |
| Cancel, signed expiring download link (forged, expired, other org) | `packages/testing/tests/badges.int.test.ts`, `apps/web/e2e/badges.spec.ts` |
| Isolation (both orgs have rows in every new table) | `packages/testing/src/fixtures.ts`, `packages/testing/tests/isolation.int.test.ts`, `badges.int.test.ts` |
| Viewer previews but every write refused (commands, direct URLs, hidden controls) | `packages/testing/tests/badges.int.test.ts`, `apps/web/e2e/badges.spec.ts` |
| Design a 4×3 fold-over template by keyboard only, assign it to a ticket type, batch PDF sorted by company, download it; axe on every screen; Arabic RTL | `apps/web/e2e/badges.spec.ts` |
| Badges nav only for the conference profile, behind the `badges` key | `packages/platform/tests/profiles.test.ts`, `apps/web/e2e/badges.spec.ts` |

## M5.5b — printing and print log (done)

### 1. Goal and users
Desk staff (box office, managers) print and reprint badges onsite, from the attendee's profile or the desk's badge search, on the event's printers; organizers see every print and reprint with its reason and know when a printer goes quiet. Plan row M5.5b and decision P5-2 (`docs/plans/phase-5.md`).

### 2. What was built
- **`BadgePrinter` port** (`packages/modules/badges/src/printer-port.ts`): `browserPrinter` (Stage 1: the desk's print dialog, AirPrint or any printer; a hand-off, no states) and `printNodePrinter` (Stage 2: REST, one platform integrator account, each org a child account addressed by its creator reference = the org id, the job id as `X-Idempotency-Key`). Dev and CI always use `fakePrintNode()`; the real adapter only with `BADGE_PRINTER_PROVIDER=printnode` and `PRINTNODE_API_KEY`. Zebra Browser Print is deferred (P5-2).
- **Printers per event** (`badges.printers`): name (unique per event among live printers), adapter, PrintNode printer number, `status` `unknown → online → offline`, last heartbeat, offline moment; archived, never deleted. PrintNode printers need PrintNode switched on for the org (`badges.print_settings`, platform staff: `pnpm --filter @yayatoh/worker printnode -- --org <slug> --on`).
- **Print jobs = the print log** (`badges.print_jobs`): one row per print or reprint of one badge, idempotent per request key. Kind is decided by the server (any earlier job that did not fail makes it a reprint); a reprint needs a reason (`damaged`, `lost`, `details_changed`, `misprint`, `printer_problem`, `other` + note), a first print is `first_print`. Browser jobs are `sent` at once and their PDF opens for 30 minutes (`/badges/jobs/{id}/pdf`); PrintNode jobs are `queued`, rendered and handed over, then `sent` or `failed` with a code. A failed job is logged but never counts. Two desks printing the same badge at once are serialized (advisory lock), so one of them is the reprint.
- **Heartbeat and offline event:** a print station page (`/badges/printing/{printer}`) beats every 30 s for browser printers; the worker polls PrintNode every 30 s for PrintNode printers. The worker's watchdog (every 5 s, leader) turns an online printer silent for 90 s offline once and emits `badges.printer_offline@1` (`{orgId, eventId, printerId, adapter, lastSeenAt, offlineAt}`); coming back emits `badges.printer_online@1`. Orgs are found through SECURITY DEFINER functions (org ids only, platform_reader, audited). The alert rule lands with M5.9a.
- **UI:** Badges page → "Printers and print log" (printers with status pills, add/archive, station links; the log with counts and First print/Reprint filters); the desk print page (`/badges/print/{ticket}`); the attendee profile's **Badge** panel (onsite print and reprint). The M5.5a one-badge PDF route (`/badges/ticket/{id}`) is replaced by the logged print flow, so no badge prints outside the log.
- Dev route `/api/dev/printers` (dev auth only): watchdog with the clock ahead, PrintNode poll, PrintNode switch, fake printer states.

### 3. Later / not yet
- Sending a batch PDF to a PrintNode printer, and counting batch badges as printed (a batch PDF is a download, already audited; it is not in the print log) — pending owner.
- PrintNode printer discovery (pick from the account's printers instead of typing the number).
- Retrying `queued` PrintNode jobs left by a crash between logging and hand-over (they stay `queued` in the log; printing again is a first print only if none counted).
- Kiosk self-print (M5.5c) uses `startPrintJobCommand` with `source: 'kiosk'`; the "printer offline" alert rule (M5.9a) subscribes to `badges.printer_offline@1`.

### 4. Acceptance
| Criterion | Test |
|---|---|
| Every print and reprint is in the log with its reason (first print logged as `first_print`; reprint without reason, `other` without note refused; idempotent; failed jobs logged but not counted) | `packages/testing/tests/badge-printing.int.test.ts`, `apps/web/e2e/badge-printing.spec.ts` |
| A printer silent for 90 s emits one offline event (89 s none; 90 s one; later ticks, two runners and reruns none; back online then silent again: a second) | `packages/modules/badges/tests/printing.test.ts`, `packages/testing/tests/badge-printing.int.test.ts`, `apps/worker/tests/printers.int.test.ts` |
| `BadgePrinter` port: browser hand-off, PrintNode REST mapping (stubbed fetch), fake PrintNode (idempotency, states, refusals), real adapter only with an explicit switch | `packages/modules/badges/tests/printing.test.ts` |
| PrintNode jobs handed over once; refused/unavailable → failed with a code; poll records online printers; per-org switch is staff-only | `packages/testing/tests/badge-printing.int.test.ts`, `apps/worker/tests/printers.int.test.ts` |
| Printers per event: unique names, archive, PrintNode needs the switch and a number | `packages/testing/tests/badge-printing.int.test.ts`, `apps/web/e2e/badge-printing.spec.ts` |
| Onsite reprint from the attendee page; desk print page; job PDF only for the job's 30 minutes | `apps/web/e2e/badge-printing.spec.ts`, `packages/testing/tests/badge-printing.int.test.ts` |
| Permissions: viewers read the log only (hidden controls, 404 station and print pages, 403 job PDF, commands refused); watchdog/report are platform steps | `packages/testing/tests/badge-printing.int.test.ts`, `apps/web/e2e/badge-printing.spec.ts` |
| Isolation: rows for both orgs in every new table; foreign org refused | `packages/testing/src/fixtures.ts`, `packages/testing/tests/isolation.int.test.ts`, `badge-printing.int.test.ts` |
| Keyboard only, axe light and dark on every new screen, Arabic RTL | `apps/web/e2e/badge-printing.spec.ts` |

## M5.5c — kiosk self-print (done)

### 1. Goal and users
An attendee at a check-in kiosk (M3.4a kiosk mode) identifies themselves, checks what their badge
will say and prints it once, without staff. Organizers turn it on per event. Anything the kiosk
can't settle (a reprint, a balance due, a registration still waiting, wrong details) goes to the desk.

### 2. What was built
- **Settings per event** (`badges.kiosk_settings`, `badges.setKioskSettings`, `events:write`; read
  with `events:read`): off by default; where kiosks print (the kiosk's own print dialog, or one of
  the event's printers, PrintNode included when switched on); whether "Use your email" is offered.
  Shown on the printing page ("Kiosk self-print"); viewers see the state only.
- **Device-only commands** (`checkin:device`; each checks `requireKioskDeviceTx`: the caller is a
  live kiosk locked to this event, and self-print is on):
  - `badges.kioskLookup`: the ticket whose active barcode payload or short code was scanned (never a
    ticket id alone) → `KioskBadgeDto` (name, company, job title as the template places them, ticket
    type, status `ready | printed | desk`) and a 5-minute pass bound to this kiosk and ticket.
  - `badges.kioskRequestCode` (factory with a `WaitingRegistrationLookup`, composed in the web app
    with `registration.hasWaitingRegistrationTx`) and `badges.kioskVerifyCode`: a six-digit code to
    the holder's own address. One own ticket → that ticket; several, or an application/approval/
    reservation still waiting → the desk; nothing → no email, same answer. Only the code's HMAC is
    stored (`badges.kiosk_challenges`; no address); 10 minutes; 5 wrong tries lock it; only the kiosk
    that asked can use it; a newer code retires older ones; the M1.14 `guestCode` limiter (scope
    `kiosk`) applies. A verified code returns the badge, its pass, and the short code the kiosk
    checks the attendee in with (never shown).
  - `badges.kioskPrint`: proof is the pass or the ticket's own code (offline queue). Idempotent per
    `requestKey`; under the same advisory lock as the desk, a badge with any counted print returns
    `printed` (no job), a balance due or no template returns `desk`. Jobs are logged
    `source = 'kiosk'`, `kind = 'print'`, `first_print`. PrintNode jobs are handed over at once.
  - `badges.kioskJobBadge`: a browser job's badge PDF for the kiosk that made it (signed token bound
    to the device, 30 minutes).
  - `badges.kioskSnapshot`: every badge's allowlisted details and status, for offline use.
- **Routes** (device bearer token): `GET|POST /api/scan/kiosk/badges` (`lookup`, `email`, `verify`,
  `print`), `GET /api/scan/kiosk/badges/pdf`. An emailed code is never in a response.
- **Kiosk screen**: after a scan that admits (or finds the ticket already in), the "Check your
  details" panel replaces the code field: name, company, job title, ticket; "Print my badge",
  "Something's wrong" (→ desk), "Not me". The browser path opens the badge PDF ("Open my badge to
  print", P5-2 stage 1: AirPrint/print dialog; the CSP allows no frames, so no silent iframe print);
  PrintNode prints silently. "No ticket with you? Use your email" → email → code → details (and the
  attendee is checked in). One attendee at a time: "Done", "Not me", a desk message (after 10 s) or a
  minute without a touch unmounts the panel, so nothing about them stays for the next person.
- **Offline**: the snapshot is sealed in IndexedDB with the device key (like the manifest), refreshed
  on start, every 30 s and on reconnect; it is only opened by the ticket a scan resolved from the
  manifest. Offline prints queue (sealed, with the scanned code as proof) only on PrintNode kiosks
  and go out on reconnect; a print-dialog kiosk sends the attendee to the desk.
- **Merged on the way**: M5.1d's balance-due override now gates M5.5b print jobs
  (`startPrintJob.overrideToken`, `badges.printState.paymentDue`; the override opens the print page).
- **Email**: message kind `badges.kiosk-code` (13 locales).

### 3. Later / not yet
- Editing details at the kiosk (corrections go to the desk).
- Choosing between several own tickets at the kiosk (sent to the desk).
- Silent printing on the browser path (needs a kiosk browser with kiosk printing or PrintNode).

### 4. Acceptance
| # | Criterion | Test |
|---|---|---|
| AC1 | A kiosk never shows another attendee's details: possession only (code or emailed code on that kiosk), allowlisted fields, other events/orgs/devices refused, scanners and members refused, nothing left on screen between visits | `packages/testing/tests/kiosk-print.int.test.ts`, `apps/web/e2e/kiosk-print.spec.ts` |
| AC2 | A printed badge is logged once: retries reuse the job, a second try (or two kiosks at once) says printed, the desk still reprints with a reason | `kiosk-print.int.test.ts`, `kiosk-print.spec.ts` (print log) |
| AC3 | Balance due, no template, several tickets and waiting registrations go to the desk | `kiosk-print.int.test.ts` |
| AC4 | Email code: same answer for unknown addresses, no address or code stored, wrong tries count, lock after 5, one kiosk only | `kiosk-print.int.test.ts`, `packages/modules/badges/tests/kiosk.test.ts`, e2e |
| AC5 | Offline snapshot: details from the sealed snapshot; PrintNode prints queue, print-dialog kiosks send to the desk | `kiosk-print.spec.ts`, `kiosk-print.int.test.ts` (snapshot) |
| AC6 | Settings: off by default, organizer only, keyboard, persisted, viewer sees no controls; axe light/dark; Arabic RTL | `kiosk-print.spec.ts` |
| AC7 | Isolation: both orgs have kiosk settings and a kiosk code in the fixture | `isolation.int.test.ts` |
