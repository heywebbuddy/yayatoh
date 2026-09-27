# M1.4 — Events, venues and content

**Roadmap:** Phase 1 → M1.4. **Risk tags:** `db-migration`, `tenancy` (owner approval).

## M1.4a — events core (this change)
- **Module `events` (tier 2), schema `events`:**
  - `events`: global slug, profile, status, visibility, IANA timezone, start/end times, venue, city, country and currency, with CHECK constraints.
  - `event_role_assignments`: event-scoped roles with optional expiry. The composite foreign key follows the tier rules.
- **Lifecycle** (`defineStateMachine` in the kernel): draft → published ⇄ draft, published → postponed → published (reschedule), draft/published/postponed → cancelled, published → completed, completed/cancelled → archived.
  - One `transitionEvent` command enforces it with `UPDATE … WHERE status = ANY(from)`.
  - Each transition is audited and emits `event.<past tense>@1`.
- **Slugs:** derived from the name, global (public URL `/events/{slug}`), and **frozen once published**.
- **Public read:** only through `events.public_event(slug)` (SECURITY DEFINER). It returns published, postponed, cancelled or completed events that are public or unlisted, from active orgs, with allowlisted columns (`PublicEventDto`).
- **Time:** organizers enter wall-clock times in the event's zone. `zonedTimeToUtc` handles the DST gap (moves forward) and overlap (earlier instant), and the conversion is tested.
- **Web:**
  - Org home lists real events, with a Suspense skeleton while loading.
  - A create-event form (Server Action).
  - The event console loads the real event (404 for foreign or unknown slugs), shows status plus lifecycle actions, and uses readiness v1 rules (details, venue, description, published).
  - The public event page is real. Tickets show an empty state until M1.5.
- **Demo overlay:** the seeded showcase events keep their demo sales, attendees, passes and agenda **in dev/preview only**, so the reference screens stay reviewable.

## Acceptance (M1.4a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Events follow the lifecycle; illegal transitions return `invalid_state` | `packages/testing/tests/events.int.test.ts`, `events/tests/lifecycle.test.ts` |
| AC2 | Slugs are unique across orgs and frozen after publish | `events.int.test.ts` |
| AC3 | Drafts and private events never have a public page; the public payload is allowlisted | `events.int.test.ts`, `e2e/events.spec.ts` |
| AC4 | Isolation: another org's event is invisible and cannot be transitioned; the fixture covers the new tables | `events.int.test.ts`, `isolation.int.test.ts` |
| AC5 | An owner creates, publishes and sees the event publicly; a viewer cannot create | `e2e/events.spec.ts` |
| AC6 | Wall-clock times convert correctly across DST | `kernel/tests/time.test.ts` |

## M1.4b — occurrences, series, templates and duplicate (this change)
**Risk tags:** `db-migration`, `tenancy` (owner approval). Migration `0039_workable_lenny_balinger.sql` (renumber on merge).

- **Dates (occurrences)** — `events.occurrences`: start/end `timestamptz`, optional capacity, `scheduled`/`cancelled`. An event without dates is a single-date event (its own times); with dates, the event's times are kept equal to the span of its scheduled dates, so lists, the public page and check-in windows stay right.
  - Added one by one, or from a **recurring schedule** (`domain/recurrence.ts`, an RFC 5545 subset): daily, weekly on chosen weekdays, monthly on a day of the month; every *n*; until a date (inclusive) or a count. It is expanded in the event's **wall-clock time**, so a 7 pm weekly event stays at 7 pm across DST (tested for America/Chicago and Europe/London; a time in a DST gap moves forward, an overlap takes the earlier instant). Months without the chosen day (the 31st) are skipped. Limits: 366 scheduled dates per event, 5 years ahead. The console **previews** the dates before saving and names every validation problem next to its field.
  - **Edit one date** (new start/end), or **this and all later dates** (new start/end time of day; each keeps its local day, so DST never shifts them). Optional capacity per date.
  - **Cancel a date**: the console first shows the impact (tickets sold for it) and links to the orders. Refunds are not automatic. A cancelled date stops selling, its tickets no longer get in, and it stays listed (marked) publicly.
- **Ticket validity per date** — ticket types list the dates they sell for (`occurrence_ids`, empty = every date). A multi-date event sells **one date per order** (`orders.occurrence_id`); the ticket carries it (`tickets.occurrence_id`). A date's capacity counts live tickets for it plus tickets in orders still holding stock, under a row lock on the date (online checkout and the box office).
  - **Rule with access dates (M1.5 multi-day passes)**: the two stay separate and both apply. The date (occurrence) says *which run* a ticket is for; access dates say *which calendar days* a pass admits within the event. Tickets without a date (guest list, imports, passes sold before the event had dates) admit on every date.
- **Check-in**: new verdict **`wrong_date`** (shared rules, online and offline). A ticket for a date admits from 6 h before to 6 h after it (the same margins as the event window), never on a cancelled date. The offline manifest header lists the dates; each row carries its date.
- **Public**: the event page shows a keyboard-friendly **date picker** (plain links, `aria-current`); sold-out and cancelled dates are listed but not selectable, capacity numbers never leave (`events.public_occurrences`). Passes appear once a date is chosen, filtered to that date. The order page and PDF show each ticket's date in the event's timezone.
- **Series** — `events.series` (+ `series_events`, one series per event): name, global slug, description. Console: an org **Series** page (create, delete, public link), a series picker on each event's Dates page, and a **series filter** on the org's event list. Public: `/series/{slug}` lists upcoming **public** events (`events.public_series*`, SECURITY DEFINER, allowlisted).
- **Duplicate and templates** — new tier-5 module `templates` (`templates.event_templates`). **Duplicate** creates a new **draft** with a new slug, the same settings, live ticket types (nothing sold, every date), checkout questions, floor plan (a draft, categories remapped, organizer blocks kept) and series; sales windows and early-bird ends move with the new start. **Save as template** stores the same snapshot (versioned JSON, instants relative to the start); **Create from template** instantiates it. Never copied: orders, tickets, attendees, check-ins, payouts, promo codes, dates, holds, guest seat assignments.
- **Web**: event nav gains **Dates** and **Duplicate & template** (every profile); org nav gains **Series** and **Templates**; "Start from a template" on the new-event page. All strings in 13 locales (Arabic RTL).

### Migration `0039_workable_lenny_balinger.sql`
- New: `events.occurrences`, `events.series`, `events.series_events`, schema `templates` with `templates.event_templates` (all `tenantTable`, FORCE RLS, org-leading indexes, composite FKs).
- Existing tables (nullable/defaulted columns only): `ticketing.ticket_types.occurrence_ids uuid[] default '{}'`, `ticketing.tickets.occurrence_id`, `orders.orders.occurrence_id` (+ partial indexes).
- Hand-written (between `-- hand-written: begin/end`): `scans_result_check` re-added with `wrong_date` as `NOT VALID` + `VALIDATE`; cross-module composite FKs `tickets_occurrence_fk` and `orders_occurrence_fk` → `events.occurrences` (`NOT VALID` + `VALIDATE`); SECURITY DEFINER functions `events.public_occurrences(text)`, `events.public_series(text)`, `events.public_series_events(text, timestamptz)`, `ticketing.public_ticket_type_occurrences(text)` with `REVOKE … FROM PUBLIC` / `GRANT EXECUTE … TO app_user`.

### Later / not yet
- Stored recurrence rules (extend a schedule, "all dates" edits of the rule); exceptions (EXDATE) other than cancelling a date.
- Per-date seat charts (M1.7f); per-date check-in counts on the door screen; filtering the orders list by date; bulk refunds of a cancelled date (M1.6 refunds are per order).
- Reducing a date's capacity below what it already sold is allowed (only new sales are refused).
- Duplicating dates with an event; template editing (a template is replaced by saving a new one).

## Acceptance (M1.4b)
| ID | Criterion | Test |
|---|---|---|
| B1 | Recurrence: daily/weekly/monthly, until/count, DST in America/Chicago and Europe/London, the 31st, limits and every validation reason | `events/tests/recurrence.test.ts` |
| B2 | Occurrence CRUD: preview writes nothing, save, single dates, duplicate start refused, edit one / this and following, event span follows | `testing/tests/occurrences.int.test.ts` |
| B3 | Cancelling a date: impact counts, no refund, stops selling, can't be edited | `occurrences.int.test.ts`, `e2e/dates.spec.ts` |
| B4 | Ticket validity per date, a date is required, per-date capacity (checkout and box office), ticket carries its date | `occurrences.int.test.ts`, `e2e/dates.spec.ts` |
| B5 | Check-in `wrong_date` online and offline; cancelled dates never admit | `checkin-engine/tests/dates.test.ts`, `occurrences.int.test.ts`, `e2e/dates.spec.ts` |
| B6 | Series: public page lists upcoming public events only, global slugs, isolation, viewer denied, console filter | `occurrences.int.test.ts`, `e2e/series-templates.spec.ts` |
| B7 | Duplicate never copies orders, tickets, attendees, check-ins, settlements, promo codes, dates, held/sold seats, seated guests (row counts) | `testing/tests/templates.int.test.ts`, `e2e/series-templates.spec.ts` |
| B8 | Templates: save, create from, unique names, isolation across orgs, viewer denied | `templates.int.test.ts`, `e2e/series-templates.spec.ts` |
| B9 | Fixture covers the new tables for both orgs (isolation suite) | `testing/tests/isolation.int.test.ts` |
| B10 | UI: recurring schedule with preview and validation errors, edit one / following, cancel with impact, buyer picks a date and the ticket shows it, scanner rejects on another date, viewer denied (hidden controls and direct URLs), keyboard, axe on every new screen and state, Arabic RTL, 375 layout | `e2e/dates.spec.ts`, `e2e/series-templates.spec.ts` |

## Remaining M1.4 increments
- **M1.4b:** done (above).
- **M1.4c:** venues (directory, org-owned, quote requests), categories and tags.
- **M1.4d:** content sections, announcements, the private-info portal, access codes, short URLs, online events.
- **M1.4e:** media pipeline (R2 + re-encode, SVG neutralized; blocked on the owner's Cloudflare account), tenant CMS, reviews.
- **M1.4f:** lightweight sessions, speakers, exhibitors and sponsors; AI drafting with the credits ledger.
- **Authorization for event roles** (`scopeFilter()`) arrives with the first event-role consumer, check-in in M1.9. The assignments are stored now.
