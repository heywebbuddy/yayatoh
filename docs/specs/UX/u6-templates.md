# U6 — Templates from scratch (UX review 1, row U6)

Plan: `docs/plans/ux-review-1.md` (finding 4, row U6). Builds on M1.4b (templates, duplicate) and M4.2a (starter templates).

## What was built
- **New template builder** (`/o/{org}/templates/new` → `/o/{org}/templates/{id}`). Step 1 asks only for the kind of event (a radio list with each profile's description), a name, description, time zone (U1 picker), currency (U1 picker) and default length. The template's page then follows the steps *Kind of event → Ticket types → Page sections → Page content → Checklist* (Stepper; the first unfinished step is current), each on its own small form:
  - default **ticket types** (name, description, price in the template's currency, quantity; hidden for profiles without ticketing, e.g. wedding; a type a saved floor plan prices cannot be removed);
  - **page sections** (the M1.4d kinds, same form and text formats as the event content page; move up/down buttons are the keyboard path);
  - **page content** (tagline, venue, city, visibility) and the name/defaults;
  - **checklist** items (the organizer's own to-dos).
  - **Events made from it** (template → events, principle 6) and the "Create an event from this template" form (the header's primary action jumps to it).
- **Edit, duplicate ("Name (copy)", opens the copy), archive and restore.** Archived templates leave every picker (the templates list shows them under a collapsed "Archived templates (n)"), are read-only and refuse new events; events already made are untouched.
- **Starters** stay read-only; "Copy to your templates" makes an editable template with the starter's profile, visibility and length in the org's time zone and currency.
- **"Save as template" on the event header** (every event page, for people with `events:write`; icon-only on phones) → the Duplicate & template page's save form.
- **Your checklist** on the setup guide: add, tick/untick (`aria-pressed` buttons), remove; events made from a template start with its items open.
- The templates page gets a **New template** primary action, a "How templates work" panel and an empty state with an action.

### Data
- Snapshot **version 2** (`templates.EventSnapshotV2`): v1 + `sections` (kind, title, content, visible) + `checklist` (titles). v1 rows are read as v2 with neither. Duplicate and "save as template" now copy page sections and checklist titles too.
- New tables: `events.event_checklist_items` (org-scoped, RLS FORCE, composite FK to the event, cascade) and `templates.template_events` (template → event links; composite FKs to the template and, hand-written, to `events.events`, both cascade). `templates.event_templates.archived_at`.
- Commands (all `tenantCommand`, `events:write`): `templates.createTemplate`, `updateTemplate`, `addTicketType`, `removeTicketType`, `addSection`, `removeSection`, `moveSection`, `addChecklistItem`, `removeChecklistItem`, `duplicateTemplate`, `setArchived`, `copyStarter`; `events.addChecklistItem`, `setChecklistItemDone`, `deleteChecklistItem`. Queries: `templates.getTemplate`, `templates.listTemplates({ archived })`, `events.checklist`.

## Later / not yet
- Editing a ticket type or a section in place (today: remove and add again); prices for early-bird, sales windows and access days in the builder (templates saved from events keep them).
- Questions and floor plans built inside a template (they come from "save as template").
- Per-event switching of workspace sections (see owner inbox).

## Acceptance
| Criterion | Test |
|---|---|
| A template made from scratch creates an event with exactly its tickets, sections, content and checklist | `packages/testing/tests/template-builder.int.test.ts` (first test); e2e `apps/web/e2e/template-builder.spec.ts` "build a template from scratch…" |
| Archived templates disappear from pickers; events made from them unaffected | int "archived templates leave the pickers…"; e2e "copy a starter, duplicate, archive and restore" |
| Edit, duplicate, archive; starters read-only but copyable | int "edits…", "duplicates a template and copies a starter…"; e2e same |
| "Save as template" on the event header | e2e "save an event as a template from the event header" |
| Permissions and isolation | int "permissions and isolation…", "event checklist"; e2e "viewers…" |
| Keyboard only, axe in both themes, RTL | e2e (keyboard radio/Enter paths, `expectAccessibleBothModes`, "the builder in Arabic (RTL)") |
| Screenshots | `docs/ux/screenshots/u6/` (before/after, light/dark, 1280/390) |
