# Spec: M3.2 — Command Center v1 (planning and pre-show)

- **Milestone:** M3.2 (roadmap Phase 3; plan `docs/plans/phase-3.md` Wave B)
- **Status:** Approved (owner, 2026-09-28: Phase 3 plan, decisions P3-1…P3-5)
- **Related ADRs:** 0008 (outbox, relay, pg-boss), 0009 (realtime), 0014 (public output allowlists), 0015 (timezones), 0016 (i18n and accessibility)

Delivered in increments: **M3.2a** Command Center shell (widget registry, role layouts, event modes,
readiness score; built in parallel on `agent/m3.2a`) and **M3.2b** alert engine (this section).

## M3.2b — Alert engine

- **Risk tags:** db-migration, tenancy
- **Branch:** `agent/m3.2b`

### 1. Goal and users
Organizers find problems before their guests do. The alert engine watches every event (and the
org's own setup) for the conditions the vision names — people without seats, tickets not handed
on, failed payments, silent check-in devices and more — raises one alert per problem, tells the
people whose role deals with it (in-app, email, text, push), links each alert to the page with the
bulk action that fixes it, and resolves it by itself once it is fixed. Users: owners, admins,
managers, finance, marketing and box office (each hears about what their role may see), viewers
(see, can't act), and the M3.2a Command Center (renders the alerts in its Alerts widget).

### 2. References
- **Roadmap M3.2:** "Readiness score. Alert engine with states, grouping and ack timeout … unseated attendees; undistributed tickets (≥10 or ≥5%); failed or stuck payments; refund surge; devices offline, low battery, queue backlog; capacity 95/100%; sell-out 90%; sales pace ≤70%; readiness blockers; domain/SSL; Connect requirements past due; deliverability; automation failures. Alerts route in-app, by email and by SMS, with a deep link into the relevant bulk action." Acceptance: the four fixture sentences, each resolving when fixed.
- **Roadmap §5.2 Alert instance:** acknowledged alerts re-fire after 60 min (10 min when live-critical); evaluator every 5 min in planning, 1 min pre-show, 15–30 s live.
- **M3.1:** the outbox relay and subscribers, `org.alerts` realtime channel (M3.1b), the metric reads the rules reuse.
- **M1.10 / M3.5a:** notifications (kinds, policy gate, quiet hours, fake providers, web push).

### 3. Scope
**Built:**
- **Module `@yayatoh/alerts` (tier 6)**, schema `alerts`: `alerts` (one row per rule and scope), `alert_history` (append-only for the app), `routing` (per role and group), `member_settings` (a member's own alert-text number), `sales_targets` (per event, for the pace rule).
- **Lifecycle** (`alertLifecycle`, pure planner `planAlert`): open → acknowledged | snoozed → resolved (automatic when the condition clears) → reopened (the same row, `reopen_count`). Acknowledgements time out while the condition holds (60 min; 10 min when critical in the live window) and the alert opens and is sent again; snoozes (1 h, 4 h, 1 day) end the same way. Grouping by rule + scope (the event, or the org). History of every change; audit of acknowledge, snooze, routing, number and target changes.
- **17 rules** (`RULES`, thresholds in `THRESHOLDS`, roadmap defaults — owner inbox "Alert engine defaults"): event rules `unseated`, `undistributed`, `paymentsFailed`, `paymentsStuck`, `refundSurge`, `devicesOffline`, `devicesLowBattery`, `devicesBacklog`, `capacityNear`, `capacityFull`, `sellOut`, `salesPace`, `readiness`; org rules `domain`, `payoutsPastDue`, `deliverability`, `automationFailed`. Each reads counts through the owning module's exported read (below); `params` hold numbers only.
- **Evaluation:** the `alerts.evaluator` outbox subscriber (27 trigger events; never replayed history) re-evaluates the event (or the org's rules) an outbox event touched; the worker's sweep (`sweepAlerts`, every 30 s: live and pre-show events; every 5 min: all events within 30 days and the org rules) notices time passing. Every evaluation recomputes each rule from its sources under the scope's advisory lock and reconciles — idempotent under replayed or duplicated events. Orgs are found with the SECURITY DEFINER `alerts.orgs_to_evaluate(limit)` (platform_reader, audited as structured log lines).
- **Routing** (`routeFor` over `DEFAULT_ROUTING`, saved rows by owners/admins): each member whose role may see the rule gets the role's channels for the rule's group. In-app (inbox + badge), email and push as `alerts.alert` (transactional, sent at once); texts as `alerts.alert-text` to the member's own number (transactional, waits out quiet hours). Deliveries are keyed by alert, sending number and member (a replay never sends twice).
- **Deep links** (`RULES[rule].fix`): unseated → Seating › Assign guests (select all, choose a row, "Seat them"); undistributed → the attendee list filtered to "Waiting to be passed on" (new filter, with the bulk actions); failed / pending / refunded payments → Analysis › Bookings filtered; devices and capacity → On-site; sell-out → Tickets & Orders; pace → Analysis; readiness → Setup guide; domain → Domains; payouts → Payouts; deliverability and failures → Messaging health.
- **Console:** Alerts page (`/o/{org}/alerts`: active/resolved, event filter, severity, state, since, fix link, acknowledge and snooze, history; live over `org.alerts`), Alert settings (`/o/{org}/alerts/settings`: own number, routing grid, sales targets), the org nav's Alerts item with the open count as its badge, and the event home's compact alerts list (`AlertsList`, the component M3.2a's Alerts widget renders). All 13 locales, Arabic RTL, keyboard, strict CSP (no inline styles).
- **Copy:** alert sentences in the web messages (`alerts.rules.*`) and the email/SMS templates (the same sentences, one source generated into both); small counts spelled out per locale (`countWords` in notifications).

**Later / not yet:**
- An organizer-side bulk "remind buyers to retry their payment" (today the alert links to the failed bookings; buyers retry from their payment page).
- Journeys and outbound webhooks as "automation failures" (M3.7a/M6.3): today failed messages and bulk actions count.
- Per-event device assignment: device rules count the org's devices in use (seen in the last 12 h) for each event in its pre-show/live window.
- Readiness blockers use two checks (unpublished, no ticket types) until M3.2a's readiness score lands; then the rule can read its blockers.
- Per-user timezone for quiet hours on texts (today: the member's push device's zone, else the org's).
- Organizer-authored alert rules (M6.2); alert thresholds per org (the owner sets platform defaults first).
- `/v1` routes for alerts (when the Command Center needs external access).

### 4. `touches:`
```yaml
touches:
  - packages/modules/alerts/**                                  # new module
  - packages/modules/seating/src/{alert-facts,index}.ts          # unseatedAttendeesTx
  - packages/modules/ticketing/src/{stats,index}.ts              # undistributedTicketIdsSql, undistributedTicketsTx
  - packages/modules/orders/src/{facts,index}.ts                 # paymentAlertFactsTx
  - packages/modules/checkin/src/{devices,index}.ts              # deviceHealthTx
  - packages/modules/tenancy/src/{queries,index}.ts, domain/permissions.ts   # domainProblemsTx, alerts:manage
  - packages/modules/payments/src/{accounts,index}.ts            # payoutRequirementsPastDueTx
  - packages/modules/notifications/src/{kinds,notifier,dispatch,index}.ts, policy/console.ts, templates/**  # kinds, href, member locales, deliverabilityFactsTx, countWords
  - packages/modules/events/src/{queries,index}.ts               # upcomingEventIdsTx
  - packages/modules/reports/src/{attendee-list,index}.ts        # distribution filter
  - packages/platform/src/{bulk,index,notifier,realtime-channels}.ts  # failedBulkOperationsTx, intent href, 'snoozed' state
  - packages/db/drizzle/0076_chemical_skullbuster.sql (+ meta)
  - packages/testing/src/{alerts,fixtures,index}.ts, src/canary/registry.ts, tests/alerts*.int.test.ts
  - apps/web/src/app/[locale]/o/[org]/(org)/alerts/**, (org)/layout.tsx, e/[event]/page.tsx, e/[event]/attendees/{page,actions}.ts(x)
  - apps/web/src/components/{alert-actions,alert-settings-forms,alerts-list,alerts-live}.tsx, src/server/{alerts,inbox,notifications}.ts
  - apps/web/messages/*.json, apps/web/e2e/alerts.spec.ts
  - apps/worker/src/{alerts,main,registry}.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `alerts.alerts` | new | rule, scope_key (`event id` or `org`), category, severity, state, count, params (numbers), opened/acknowledged/snoozed/resolved times, notify and reopen counts; unique `(org_id, rule, scope_key)`; FK `(org_id, event_id)` → events ON DELETE CASCADE |
| `alerts.alert_history` | new | action, state, count, actor (member or engine), at; FK → alerts ON DELETE CASCADE; `UPDATE`/`TRUNCATE` revoked from `app_user` |
| `alerts.routing` | new | role × group → channels (`in_app`, `email`, `sms`, `push`); unique per org |
| `alerts.member_settings` | new | `sms_phone` (E.164 CHECK; personal) per member |
| `alerts.sales_targets` | new | tickets per event; FK → events ON DELETE CASCADE |

- **RLS:** all five via `tenantTable` (org_id NOT NULL, ENABLE + FORCE, canonical NULLIF policy, org-leading indexes, org-scoped uniques). Fixture rows for both orgs in `createOrgFixture` (an evaluated, acknowledged alert with history, a routing row, the owner's number, a sales target). Column privacy in `private-columns.ts` (registered for the canary crawler).
- **Migration** `packages/db/drizzle/0076_chemical_skullbuster.sql` (new schema and tables only; no locks on existing tables). **Hand-written block** (`-- hand-written: begin/end`): the two composite FKs to `events.events (org_id, id)` ON DELETE CASCADE (`alerts_event_fk`, `sales_targets_event_fk`); `REVOKE UPDATE, TRUNCATE ON alerts.alert_history FROM app_user`; `alerts.orgs_to_evaluate(p_limit integer)` (SECURITY DEFINER, `search_path = pg_catalog`, returns org ids only; `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO platform_reader`). Nothing destructive.

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Queries / commands** (entitlement `core`): `alerts.list`, `alerts.count`, `alerts.history` (`events:read`, filtered by the caller's role per rule); `alerts.acknowledge`, `alerts.snooze` (`alerts:manage`, audited); `alerts.routing` (`members:read`), `alerts.setRouting` (`members:manage`, audited); `alerts.mySettings`, `alerts.setMyPhone` (`org:read`, own row only, audited without the number); `alerts.salesTarget` (`orders:read`), `alerts.setSalesTarget` (`events:write`, audited).
- **Permission** `alerts:manage` (new): owner, admin, manager, finance, box office.
- **Attendee list:** `reports.attendeeList` / bulk selection gain `distribution: 'pending'` (additive).
- **Notifications:** kinds `alerts.alert`, `alerts.alert-text`; `NotificationIntent.href` (in-app link for `enqueue`, additive); members' rows of every channel render in the member's language.

### 7. Events
No new domain events. Consumer `alerts.evaluator` of `order.paid/payment_failed/payment_started/expired/refunded`, `tickets.cancelled`, `ticket.claimed/admitted/admission_undone`, `attendee.cancelled`, `attendees.changed`, `seating.assignments_changed`, `ticket_type.created/updated/archived`, `event.updated/published/unpublished/postponed/rescheduled/cancelled/completed/archived`, `device.enrolled/state_changed/heartbeat`, `domain.added/activated/removed/primary_changed`, `payouts.account_updated`, `messaging.auto_paused`, `org.suspension_changed`, `bulk.completed` (all @1). Realtime: `org:{org}:alerts` `alert {alertId, eventId, state, severity, at}` on every change (state enum gains `snoozed`).

### 8. Security and privacy
- The org is always the route's or the event's; queries filter rules by the caller's role (a viewer sees no payout or domain alerts; finance no seating alerts); another org's alert is `not_found`.
- Outputs are allowlisted (`AlertDto`: numbers, states, the event's name and slug, the fixing path); `params` keep numbers only even if the column holds anything else. Messages carry the rule, count, severity and event name.
- A member's alert number is theirs alone (own-row commands, `personal` column, never in audit data).

### 9. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | The fixture event gives exactly "37 attendees do not have seats", "120 purchased tickets have not been distributed", "14 payments failed", "Three check-in devices are offline" (and nothing else), each deep-linked to its fix | `packages/testing/tests/alerts.int.test.ts`, `apps/web/e2e/alerts.spec.ts` |
| AC2 | Each resolves automatically when fixed (seat everyone, distribute, retry, devices back); a new unseated guest reopens the same alert | `alerts.int.test.ts` |
| AC3 | Idempotent: re-evaluation and replayed or duplicated outbox events change and send nothing; replayed history is never taken | `alerts.int.test.ts` |
| AC4 | Every other rule fires and resolves on its facts (battery, backlog, stuck, failed ≥ 3, refund surge, capacity 95/100 %, sell-out, pace, readiness, domain, payouts, deliverability, automation) | `packages/testing/tests/alerts-rules.int.test.ts` |
| AC5 | Lifecycle: acknowledge, snooze (and invalid durations), acknowledgement timeout 60 min / 10 min live-critical, snooze end; history; audit | `alerts.int.test.ts`, `alerts-rules.int.test.ts`, unit `packages/modules/alerts/tests/lifecycle.test.ts` |
| AC6 | Routing by role and group: in-app, email, push and texts to the right members only; texts wait out quiet hours while email and push go; members' numbers validated; only owners/admins change routing | `alerts-rules.int.test.ts` |
| AC7 | Permissions and isolation: viewers can't acknowledge or snooze; roles see only their rules; scanners are refused; another org sees and changes nothing; RLS | `alerts.int.test.ts`, `packages/testing/tests/isolation.int.test.ts` |
| AC8 | Rule evaluation, thresholds, event modes, routing defaults, catalogue; number spelling per locale | unit `packages/modules/alerts/tests/rules.test.ts`, `packages/modules/notifications/tests/numbers.test.ts`, `packages/modules/notifications/tests/render.test.ts` |
| AC9 | End to end: the four alerts with exact text; keyboard acknowledge and snooze; history; reload; badge; seating the attendees from the "Seat them" link resolves the alert live in another tab; deep links for distribution, payments and devices; event home list; viewer without controls and read-only routing; scanner 404; empty states; settings (validation, routing, target, persistence); axe on every screen; Arabic RTL | `apps/web/e2e/alerts.spec.ts` (×3 viewports) |

### 10. Gate results (M3.2b)
- `pnpm verify`: lint, check:modules, typecheck, 1,506 unit tests (134 files), 978 integration tests (113 files) — all pass.
- New tests: unit `alerts/tests/rules.test.ts` + `lifecycle.test.ts` (26), `notifications/tests/numbers.test.ts` (2), render snapshots for the two new kinds × 13 locales (26), `tenancy` permissions (+1); integration `alerts.int.test.ts` (11) and `alerts-rules.int.test.ts` (12); e2e `alerts.spec.ts` 7 tests × 3 viewports = 21, all pass.
- Whole web e2e suite: 1,426 passed, 34 skipped, 2 failed, 2 did not run. The two failures pass on re-run and are load/timing tests unrelated to alerts: `seating-perf.spec.ts:165` (desktop, frame-rate probe `editorPanZoomed` under the full parallel run; passes alone) and `legacy-migration.spec.ts:344` (desktop, two offline devices' duplicate flag; the whole serial spec passes 20/20 on re-run).
