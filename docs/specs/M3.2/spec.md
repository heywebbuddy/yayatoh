# Spec: M3.2 — Command Center v1 (planning and pre-show)

- **Milestone:** M3.2 (roadmap Phase 3; plan `docs/plans/phase-3.md` Wave B)
- **Status:** Approved (owner, 2026-09-28: Phase 3 plan, decisions P3-1…P3-5)
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** 0008 (outbox), 0009 (realtime), 0015 (time), 0018 (design tokens)

## 1. Goal and users
Organizers run an event from one screen: what needs fixing before doors, how sales and the door
are going, and what comes next. Different people need different screens: an owner wants the whole
picture, finance the money, door staff the door and **never the revenue**. The screen also changes
with the event's life: planning, the day before, live, and the week after. M3.2 is delivered in
increments: **M3.2a** Command Center shell (this document), **M3.2b** alert engine (built in
parallel; it fills the `alerts` slot defined here).

## 2. References
- **Vision:** §7 Command Center (revenue, event readiness, live event-day metrics, realtime).
- **Roadmap:** M3.2 "Widget registry (module, role, profile, mode). Role layouts: owner, ops, finance, door, marketing. Event modes: planning → pre_show (T−24 h) → live (doors −2 h to end +2 h, venue timezone) → wrap (+7 d). Readiness score … Acceptance: … The door layout shows no revenue."
- **Builds on:** M1.4f readiness engine, M3.1a metrics projections and query API, M3.1b realtime channels.
- **Legacy evidence:** none (the legacy platform has no Command Center).

## M3.2a — Command Center shell (built)

### Where it lives
A new module **`@yayatoh/command-center`** (`packages/modules/command-center`, tier 6, Postgres
schema `command_center`). Tier 6 because it reads reports (5), check-in (4), seating, ticketing and
program (3), events (2), tenancy and billing (1), always through their exported queries and `*Tx`
reads inside the caller's tenant transaction. The readiness engine (M1.4f) moved from the web app
into the module (`domain/readiness.ts`, browser-safe via `@yayatoh/command-center/client`);
`apps/web/src/lib/readiness.ts` re-exports it, so the wizard, setup guide and event home are
unchanged.

### Built
- **Widget registry.** `WIDGET_META` (browser-safe) describes each widget: `key`, i18n title
  (`commandCenter.widget.<key>.title`), `module` (entitlement), `permission`, allowed `roles`,
  `profiles`, `modes`, `size` and realtime `channel`; `revenue: true` marks money.
  `defineWidget(meta, output, load)` pairs it with a **loader**: a `tenantQuery`
  (`commandCenter.<key>Widget`: validate → entitlement → permission → tenant transaction → handler →
  Zod allowlist) whose handler first resolves the caller's Command Center role for the event
  (`callerScopeTx`) and refuses (`forbidden`) any widget the registry does not allow them.
  `createWidgetRegistry` / `withWidget` compose the app's registry; **M3.2b's hook** is
  `withWidget(COMMAND_CENTER_WIDGETS, defineWidget(WIDGET_META.alerts, …))`, replacing the
  placeholder `alerts` slot (`engine: 'pending'`). Unknown keys never render (the page shows only
  registered widgets; the widget endpoint 404s) and forbidden ones never load.
- **Widgets** (from existing data, allowlisted DTOs, ISO times, money in minor units per currency,
  never summed across currencies):

  | Widget | Module | Permission | Roles | Modes | Live over |
  |---|---|---|---|---|---|
  | `readiness` — score 0–100, blocking items and other to-dos with deep links | core | events:read | owner, ops, marketing | planning, pre-show | 30 s poll |
  | `sales` — total, today (event time zone) and refunds per currency; orders (**revenue**) | reports | orders:read | owner, ops, finance | all | `event.metrics` |
  | `tickets` — sold vs capacity, comps | ticketing | events:read | owner, ops, finance, marketing | all | `event.metrics` |
  | `checkins` — today, total vs valid tickets | checkin | events:read | owner, ops, door | pre-show, live, wrap | `event.checkins` |
  | `seatFill` — occupied vs all seats (wedding, gala, conference) | seating | events:read | owner, ops, door | pre-show, live, wrap | `event.metrics` |
  | `devices` — online vs enrolled, low battery (≤ 20 %) | checkin | events:read | owner, ops, door | pre-show, live | `event.devices` |
  | `timeline` — next mode changes, other dates, next sessions | core | events:read | all | all | 30 s poll |
  | `alerts` — slot for M3.2b | core | events:read | all | all | `org.alerts` |

- **Role layouts.** `commandCenterRole(orgRole, eventRoles)` maps members to **owner** (owner,
  admin), **ops** (manager, box office, event manager; a plain viewer read-only), **finance**,
  **marketing**, **door** (door staff and session scanners at this event, scanners). An event role
  wins over a generic one (a viewer made door staff gets the door layout). `DEFAULT_LAYOUTS[role][mode]`
  lists the shown widgets in order; other widgets available to the role in that mode start hidden.
  **The door never gets revenue**: the sales widget is `revenue: true`, which `widgetAllowed`
  refuses for the door role regardless of its role list; no default door layout lists it; a door
  member can't save it into a layout; its loader refuses the door role even when called directly.
- **Rearranging.** Per member per event (`command_center.layouts`: order + hidden). "Customize
  layout" shows Move up / Move down / Hide buttons on each widget and Show buttons for hidden ones
  (the keyboard alternative), plus a drag handle (pointer). Every change saves at once (command
  `commandCenter.saveLayout`, audited), is announced in a polite live region, and focus stays on the
  control used. "Reset to default" removes the row (`commandCenter.resetLayout`). Stored keys are
  validated against the registry on write and filtered by role, profile, module and mode on read.
- **Event modes** (`domain/modes.ts`, pure): planning → **pre-show** from the same wall-clock time
  the day before the start (event's IANA zone) → **live** from doors −2 h (doors = start until
  events have a doors time) to end +2 h → **wrap** until end +7 wall-clock days → settled (stays
  wrap, leaves the overview). Multi-date events use the current date: live one, else the next one
  within its pre-show, else wrap of the last one that ended (until the next date's pre-show or the
  wrap's end), else the next one (planning); cancelled dates are ignored. Each result carries its
  window and `nextChangeAt`; the page re-renders itself at that moment (server clock).
- **Manual mode** (`command_center.mode_overrides`, command `commandCenter.setMode`, permission
  `events:write` incl. event managers, audited `commandCenter.mode.override` / `.clear` with the
  computed mode it overrode). The override wins until set back to "Automatic".
- **Readiness score** (`readinessScore`): blocking rules (name and dates, venue, an upcoming date,
  tickets, published) weigh 2, others 1; the widget lists blocking items first, each a link to the
  console page that fixes it (the M1.4f rule's `path`).
- **Pages.** `/o/{org}/e/{event}/command-center` (nav: "Command Center" after Home, every profile)
  and the multi-event overview `/o/{org}/command-center` (org nav, `events:read`): events that are
  live, in pre-show, planning or wrapping up, live first, with mode, "Set by hand", start (event
  zone) and readiness for roles that see it; no money. All 13 locales, Arabic RTL, tokens only,
  24 px targets, no inline styles (strict CSP; meters are native `<meter>` elements).
- **Widget endpoint** `GET /api/command-center/{org}/{event}/{widget}` (the board's live re-read):
  401 signed out, 404 unknown org/event/widget or not a member, 403 a widget the role may not see
  (the door asking for `sales`), 200 `{widget, data}`. Tenant from the path + session only.
- **Live updates.** The board follows each shown widget's channel the member may attach to
  (`event.checkins`/`event.devices` need `checkin:scan`, `event.metrics` `events:read` + reports,
  `org.alerts` an org role with `events:read`) and re-reads that widget through the endpoint
  (one re-read per burst, 250 ms); widgets without a followable channel re-read every 30 s.
  - The worker's metrics projector now publishes a **value-free** `metric {metric: 'changed', value: 0}`
    ping on `event.metrics` after each live change (`publishMetricsChangedTx`, via a new `tx`
    argument on the projector's `onChange`). The channel admits door staff, so it must never
    carry a figure; the widget's loader applies the role rules.
  - `command-center.devices` (worker subscriber on `device.enrolled/state_changed/heartbeat`)
    publishes device presence (id, state, battery, queue depth) to `event.devices` of the org's
    events that are in pre-show or live (devices belong to the org, not one event).
- **Dev clock** (e2e "mocked clock"): the `yy_dev_clock_offset` cookie shifts the Command Center's
  "now" by that many ms; honoured only when the dev shortcuts are on (never in production).
- **Seating:** new narrow read `seatFillTx(tx, eventId)` → `{occupied, total}`.

### Migration
`packages/db/drizzle/0076_light_jack_murdock.sql` (to be renumbered at merge): creates schema
`command_center` with `layouts` (event, user, `widget_order text[]`, `hidden_widgets text[]`,
≤ 32 each; unique per org/event/user) and `mode_overrides` (event, mode ∈ planning/pre_show/live/wrap,
set by/at; unique per org/event), both `tenantTable` (ENABLE + FORCE RLS, NULLIF policy,
org-leading indexes). **Hand-written section:** composite FKs `layouts (org_id, event_id)` and
`mode_overrides (org_id, event_id)` → `events.events (org_id, id)` ON DELETE CASCADE, and
`layouts (org_id, user_id)` → `tenancy.memberships (org_id, user_id)` ON DELETE CASCADE (leaving the
org removes the member's layouts). New tables only; nothing destructive.

### Later / not yet
- **M3.2b** alert engine: rules, states, grouping, routing; registers the real `alerts` loader with
  `withWidget` and publishes on `org.alerts` (the slot, channel and endpoint are ready).
- Events have no separate **doors time** yet: live mode starts 2 h before the start. When a doors
  field lands, pass it as `doorsAt` (already supported by `computeEventMode`).
- A sweep for silent devices (offline alert within 90 s) and the device board: M3.3.
- Sales pace and conversion widgets; per-entrance speed; TV mode: M3.3/M6.2.
- Web read-your-writes (`applyUnpublishedMetricEvents`) does not publish the metrics ping; in
  production the worker handles almost everything first, so pings arrive; where no worker runs,
  sales/tickets/seat widgets refresh on reload (check-ins are live everywhere: the scan command
  publishes in its own transaction).
- Readiness and timeline have no channel: they re-read every 30 s.
- `/v1` routes for the Command Center: when external dashboards need it.

### Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | **The door layout shows no revenue**: no sales widget in any door layout, mode or profile; the sales loader refuses the door role even though the viewer's org role has `orders:read`; a door member can't store it in a layout; `GET …/sales` answers 403 to the door and 200 to the owner | unit `packages/modules/command-center/tests/domain.test.ts`; int `packages/testing/tests/command-center.int.test.ts`; e2e `apps/web/e2e/command-center.spec.ts` ("door layout shows no revenue") |
| AC2 | Role layouts: owner, ops, finance, door, marketing get their defaults per mode; a viewer gets ops read-only; a scanner has no Command Center | unit `domain.test.ts`; int `command-center.int.test.ts`; e2e `command-center.spec.ts` |
| AC3 | Registry: widgets filtered by role, profile, module and mode; unknown keys dropped; loaders refuse forbidden widgets server-side; API keys and anonymous callers refused; the alerts slot can be replaced (`withWidget`) and its replacement applies the same rule | unit `domain.test.ts`; int `command-center.int.test.ts` |
| AC4 | Modes planning → pre-show (T−1 wall-clock day) → live (doors −2 h … end +2 h) → wrap (+7 days) → settled, in the event's zone across DST (23/25 h), half-hour and southern zones; multi-date events use the current date; rescheduling moves the boundaries | unit `domain.test.ts`; int `command-center.int.test.ts` |
| AC5 | Manual mode: owners and (event) managers set/clear it, audited with the computed mode; door, finance, marketing and viewers refused | int `command-center.int.test.ts`; e2e `command-center.spec.ts` (mocked clock test) |
| AC6 | Rearranging by keyboard (move, hide, show, reset) persists after reload, per member per event; focus stays on the control; drag handle as the pointer path | int `command-center.int.test.ts`; e2e `command-center.spec.ts` (owner test) |
| AC7 | Mode changes with a mocked clock without a reload (at `nextChangeAt`), and on reload for live and wrap; layouts change with the mode | e2e `command-center.spec.ts` |
| AC8 | Readiness score 0–100 with blocking items and deep links; it rises as items are fixed | unit `domain.test.ts`; int `command-center.int.test.ts`; e2e owner test |
| AC9 | Widgets equal the metric projection (sales, tickets, check-ins); check-ins follow a scan; the live count updates on screen when another door scans (no reload) | int `command-center.int.test.ts`; e2e ("live check-in count") |
| AC10 | Realtime scoping: the metrics ping carries no figure and only names the org's own channel; device presence reaches only the org's pre-show/live events; nothing crosses orgs | int `command-center.int.test.ts` ("realtime channel scoping") |
| AC11 | Isolation: another org's event, layouts and overrides are unreachable (queries, commands, RLS); both orgs have rows in both new tables | int `command-center.int.test.ts`; `packages/testing/tests/isolation.int.test.ts` |
| AC12 | Org overview: live first, mode and "Set by hand", readiness only for roles with the readiness widget, no money, links to each Command Center | int `command-center.int.test.ts`; e2e (mocked clock test) |
| AC13 | Every new screen and state passes axe; Arabic RTL renders; empty states (no widgets shown; no access) | e2e `command-center.spec.ts` |

### Gate results (M3.2a)
- `pnpm verify`: lint, check:modules, typecheck, 1471 unit tests (132 files; 20 new in
  `command-center/tests/domain.test.ts`), 971 integration tests (112 files; 16 new in
  `command-center.int.test.ts`) — all pass.
- Web e2e: `command-center.spec.ts` 12/12 (4 tests × 3 viewports). Whole suite (1455 tests):
  the first run was cut by a session time limit at 1278; of those, 5 failed: the new overview
  check (the shared dev org had more than 30 live test events; fixed: the test uses a fresh org
  and the overview now lists 50 with a "showing N of M" note) and two long journeys that hit their
  30 s timeout under full parallel load (`attendees.spec.ts:7` tablet, `distribution.spec.ts:21`
  tablet and desktop; they pass on the other viewports and on rerun). The remaining 181 desktop
  tests (`seat-assignment` … `wizard`) and a rerun of `command-center`, `attendees` and
  `distribution` on all viewports all pass (181/181, 24/24).
