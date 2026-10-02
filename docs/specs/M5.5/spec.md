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
