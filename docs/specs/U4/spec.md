# U4 — Command Center v2

Source: `docs/plans/ux-review-1.md` (approved 2026-10-03), finding 10 ("Command Center UI not good": empty grid cells, a placeholder alerts tile, no hero) and UX principle 7 ("Dashboards have a hero"). Brief: `docs/agent-briefs/u4.md`.

## What was built

### Hero strip (event Command Center)
- **Countdown** in the reader's locale: "Starts in 2 days, 23 hours" → "Ends in 2 hours, 40 minutes" → "Ended 3 hours ago" (`countdown`, `durationParts` in `domain/hero.ts`; units worded with `Intl.NumberFormat` unit style and `Intl.ListFormat`). It ticks every 30 s on the server's clock (the dev clock cookie included) and shows the date in the event's time zone.
- **The mode** (pill, next change, manual note) and, for members who can edit the event, the mode control (now U1's `Select`).
- **The single next action**, the screen's one primary button (`nextAction`): a critical alert, then the first blocking readiness item, then a warning alert, then (live) "Start scanning" for members who scan, then the first other readiness item, then the public event page before the show or the report after it (roles that read money only). It is fed by the member's own readiness and alerts loaders, so it never knows more than the member may see (the door's alerts are door alerts only). "Open scanner" in the page header became a secondary button.
- The hero lives in `CommandCenterShell`, outside the keyed board, so the mode control keeps its "Mode updated." message when the board re-renders for the new mode; the board feeds it each fresh readiness and alerts read.

### KPI row
- Sales (first currency, today's amount, other currencies), tickets sold of capacity, check-ins of valid tickets, open alerts (critical count, "All clear").
- Role-filtered by the widget registry's own rule (`kpiKeys` = `widgetAllowed` of the source widget): owner/ops all four, finance sales/tickets/alerts, marketing tickets/alerts, **door check-ins and alerts only (never sales)**; a wedding has no sales or tickets. `eventViewQuery` returns `kpis` (additive). The figures come from the same loaders as the widgets (a door request for sales is still refused by the loader) and follow the same live channels, also while the widget itself is hidden.

### Dense packing, no empty cells
- `packSpans` / `boardSpans` (`domain/pack.ts`): each widget asks for its size's span (sm 1, md 2, lg 3) capped at the columns (1 phone, 2 from 768 px, 3 from 1280 px); the member's order is kept (visual order = keyboard and screen-reader order); when the next widget doesn't fit, the row's last widget grows to fill the row, and the last row is filled the same way. The grid also has `grid-auto-flow: dense` as a safety net. The KPI row packs the same way (`kpiSpans`: two per row on a phone, the odd one spanning both).

### Readiness checklist with deep links
- The readiness widget lists **every** counted item, done (ticked) or not, in two groups ("Needed to sell", "Recommended"), with "n of m done" under the ring.
- Every open item links to the exact field or add form that fixes it: `READINESS_FIELDS` (`details#details-venue`, `content#tagline-heading`, `content#add-section-heading`, `dates#add-date-heading`, `tickets-orders#add-ticket-type-heading`, `sessions#new-session-title`, `speakers#new-speaker-name`, `guests#new-party`, `seating#quick-heading`, `tables-sponsors#sold-heading`, event home `#event-action-publish`). Rules carry `field`; the widget DTO adds `field` and `items` (additive). Two ids were added to pages: the add-ticket-type heading and the event home's action forms (`event-action-{action}`).

### Alerts tile
- Already the real M3.2b engine in the web registry; the empty state is no longer a bare line: "No open alerts." with a success dot, what the rules watch, and "See all alerts" (the org alert list filtered to the event). The list view links there too.

### Org overview
- Counts per mode on top (Live, Pre-show, Planning, Wrap-up), then one section per mode with a table: event, mode, start, **sales** (per currency), **tickets** ("2 of 120"), **readiness** (percentage and bar).
- `orgOverviewQuery` adds `sales` and `tickets` per event (additive): sales only when the sales widget is allowed for the member's org-level role **and** they hold `orders:read`; tickets when the tickets widget is allowed. The org scanner (the only org-level door) has no overview at all. The page applies unpublished metric events first, like the widgets.
- The empty state now has a primary action (see all events).

## Decisions
- The packing keeps the member's order and grows widgets rather than reordering them (reordering per breakpoint would break the keyboard "Move up/down" order and the screen-reader order).
- The hero's "next action" is computed in the browser from the member's own loader reads (pure `nextAction`), not by a new server query: the alert engine is the same tier as the Command Center and plugs in through the app (`withWidget`).
- The overview test that asserted "no money" (M3.2a) was replaced by role-based money assertions: the owner-approved UX plan asks for money per event.

## Later / not yet
- Social profiles (wedding, gala without tickets) could get RSVP/arrivals KPIs instead of sales/tickets.
- The overview has no org-level totals row (sums across currencies are not allowed; a per-currency total could come with U5's Money section).

## Acceptance

| Criterion | Test |
|---|---|
| Snapshots at 390, 1024, 1440 px show no empty cells (owner, ops, door) | `apps/web/e2e/command-center-v2.spec.ts` (`expectPackedAtAllWidths`: every grid row spans edge to edge; screenshots attached), `packages/modules/command-center/tests/board.test.ts` (exhaustive packing, every default layout of every role/mode/profile) |
| The door never sees revenue | `board.test.ts` (KPI keys, even with a leaky registry), `packages/testing/tests/command-center.int.test.ts` ("U4 KPI row", overview money by role), `command-center-v2.spec.ts` (door view: no sales KPI, no `$`), existing `command-center.spec.ts` door test |
| Readiness items deep-link to the exact field | `apps/web/tests/readiness-fields.test.ts` (each id is on its page), `board.test.ts`, int test "readiness checklist", e2e (click → `#details-venue`, `#tagline-heading` in view) |
| Hero: countdown, mode, next action | `board.test.ts` (`nextAction`, `countdown`, `durationParts`), e2e planning/live/door |
| Alerts tile is the real engine, no placeholder | e2e (all-clear state with "See all alerts"), existing `alerts.spec.ts`, `social-pack.spec.ts` |
| Org overview with money and readiness per event, role-filtered | int test "shows each event's sales and tickets only to roles that read money", e2e overview |
| Owner planning, live, door views; customize still works; keyboard; axe both themes; RTL | `command-center-v2.spec.ts`, `command-center.spec.ts` |
