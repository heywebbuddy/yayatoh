# U7 — Series and events, connected

Approved plan: `docs/plans/ux-review-1.md` (review point 9, UX principle 6, row U7). Brief: `docs/agent-briefs/u7.md`. Builds on U1 (Combobox, Select, date pickers).

## What was built (this change)

Review point 9: create-event had no series field (an event joined a series later, in its Dates tab), and the public event page never mentioned its series. U7 connects both ways (principle 6, "every created item links back to where it is used").

- **Create-event, quick and guided:** a **Series (optional)** field (U1 Combobox). Pick one of the org's series, keep "No series", or type a new name and choose "Create “…”". The guided wizard has it on step 1 (Basics), keeps it on Back/Next and names it in the step 3 summary. `?series={id}` on `/events/new` and `/events/new/guided` picks a series in advance.
- **`events.createEventInSeries`** (new command, `packages/modules/events/src/series-events.ts`): creates the event and joins an existing series, or creates the new series, in **one transaction** — either both exist afterwards or neither does. A taken series address is a `conflict` on the `series` field (never on the event's `slug`, which the quick form retries on). Same `event.created@1` (and `series.created@1` for a new series) as before; idempotent with the form's request key.
- **Event header:** "Part of {series}" next to the status pill on every event page, linking the console series page (only for people who can read the org's series; co-hosts with an event role only don't see it).
- **Series page** `/o/{org}/series/{slug}` (the list's names now link to it), with two tabs:
  - **Events:** each event's status (pill), dates (in the event's time zone) and sales (tickets sold and gross, from the M1.12 org report; only with the reports module and `orders:read`); open an event; **Remove from series** (the event stays); **Add an existing event** (an event in another series moves here); **Create event in this series**; the empty state leads to that link.
  - **Details:** name and description (the public address stays), the public page link, **Delete series** (events stay).
- **Create next event in series** (`/o/{org}/series/{slug}/next`, the page's primary action): duplicates the **latest** event (by start) with the existing `templates.duplicateEvent` — settings, ticket types, questions and seating plan, never orders, attendees or check-ins — as a **draft in the same series**, and opens it. The form suggests the name (a year in the name that is the event's year moves on: "Fest 2027" → "Fest 2028") and the start (the gap between the last two events, or a year with one; moved on until it is in the future; `apps/web/src/lib/series-next.ts`).
- **Public event page:** a "Part of {series}" chip in the hero links the public series page (`publicEventSeries(target)`, read under the event's org RLS, slug and name only; allowlist serializer `events.publicSeriesRef`).
- New reads: `seriesDetailQuery` (by slug; events of any status, earliest first), `eventSeriesQuery` (an event's series or null).

## Migration

**None.** Everything uses the M1.4b `series` / `series_events` tables and the existing SECURITY DEFINER public series functions.

## Later / not yet
- Sales on the series page are all-time (no period picker); a series-level total and trend could follow with the reports track.
- "Create next event" copies the latest event by start date; choosing which event to copy is not offered.
- Reordering events inside a series (they sort by start).
- The U1 Combobox's default `selectedOptions = []` is a new array each render and sits in the deps of its option-sync effect, so it re-renders in a loop (React #185 after a server-action re-render). The Series field passes a stable `selectedOptions`; the component itself should be fixed in `packages/ui` (reported for U1).

## Acceptance (U7)

| Criterion | Test |
|---|---|
| An event created inside a series (new or existing) appears on the console series page and the public series page | `apps/web/e2e/series-events.spec.ts` (create in a new series; pick an existing series; guided wizard); `packages/testing/tests/series-events.int.test.ts` (joins an existing series; creates a new one inline) |
| Removing it unlinks both ways (series page, event header, public event page, public series page) | e2e "…remove one"; int "removing an event unlinks it…" |
| "Create next event" copies the setup and lands as a draft in the series | e2e (copies the pass, Draft, Part of {series}, both rows earliest first); int "the next event copies the latest edition…"; unit `apps/web/tests/series-next.test.ts` (name and start suggestion) |
| Validation: taken / too-short new series name, too-short next name, nothing chosen to add, too-short rename | e2e; int (conflict on `series`, nothing created; invalid event leaves no series; exactly one of id or name) |
| Permissions: viewers see the series and its events but no add/remove/next/edit/delete; `/next` 404s; other orgs see nothing | e2e "viewers…"; int "viewers are refused; another org cannot use this series" |
| Empty state says what to do next and pre-picks the series | e2e "an empty series page leads to…" |
| Keyboard only (type + Enter to create a series, keyboard pick to add, Enter on Remove) | e2e |
| axe in light and dark (create-event, event header, series Events/Details/Next, public event page); Arabic RTL (public event page, series page, create-event); no sideways scroll | e2e |
| Before/after screenshots (1280 and 390 px, light and dark) | `docs/ux/screenshots/u7/` |
