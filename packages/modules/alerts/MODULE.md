# alerts (tier 6)

The alert engine (M3.2b): rules evaluated from the outbox and on a schedule, alert instances with
their lifecycle and history, per-role routing, and delivery through notifications. Owns Postgres
schema `alerts` (`alerts`, `alert_history`, `routing`, `member_settings`, `sales_targets`). The
facts it measures belong to the modules below it (seating, ticketing, orders, check-in, tenancy,
payments, notifications, platform); it reads them through their exported counts only.

**Invariants**
- **One alert per rule and scope.** The scope is the event (`scope_key` = its id) or the org. A
  condition that clears resolves the alert automatically; the same condition coming back reopens
  the same row (`reopen_count`), so an event never piles up duplicates.
- **Lifecycle** (`alertLifecycle`): open → acknowledged | snoozed → resolved, and resolved →
  open (reopen). An acknowledgement that is still firing after 60 minutes (10 when live-critical)
  opens again and is sent again; a snooze ends the same way. Every change is a row in
  `alert_history` (append-only for the app) and a message on the org's `alerts` realtime channel
  (ids and states only).
- **Idempotent evaluation.** Every evaluation recomputes each rule from its sources under the
  scope's advisory lock, then reconciles (`planAlert`, pure). The `alerts.evaluator` subscriber
  handles each outbox event once (`processed_events`) and never takes replayed history; the
  worker's sweep (`evaluateOrgNow`) notices time passing. Evaluating twice changes nothing and
  sends nothing twice (deliveries are keyed by alert, sending number and member).
- **Thresholds are config** (`THRESHOLDS`, roadmap defaults pending the owner). Rules only read
  counts; `params` hold numbers only (never names or ids of people).
- **Visibility and routing.** A member sees (and is told about) a rule only if their role has the
  rule's permission (`RULES[rule].permission`). Routing is per role and group (`routing`, over
  `DEFAULT_ROUTING`); owners and admins change it (`members:manage`). In-app, email and push go out
  at once (`alerts.alert`, transactional); texts go to the member's own number
  (`member_settings`, their own setting only) as `alerts.alert-text`, which waits out quiet hours.
- **Acknowledge and snooze** need `alerts:manage` (not viewers or scanners); both are audited.
- Every alert links to the console page that fixes it (`RULES[rule].fix`).
- **Live-critical escalation (M3.3a):** a live-critical alert (devices offline or capacity while live, failed payments at the critical level while live) goes to members on duty at the event (check-in's `onDutyStaffTx`: staff presence) in-app and by push whatever their routing, and their text as `alerts.alert-urgent-text` (urgent: no quiet hours); door-only staff (viewer/scanner) only for door alerts. It re-sends when an acknowledgement times out (10 min). `watchQuietDevices` (the worker's per-second live watchdog) records devices going quiet and evaluates the org's live and pre-show events at once.
- **Same-tier sources only through the outbox** (batch 3e): journeys (`automations.journey_step_failed@1`)
  and campaigns (`campaigns.send_failed@1`) are recorded once per outbox event as `signals` (kept 7
  days) and counted by the org rules; this module never imports them, and they never import it.
  Dispute deadlines (`payments`, a lower tier) are read as counts (`disputeDeadlineFactsTx`).
- **Conference pack (M5.9a):** ten event rules (`evaluateConferenceRules`) read counts from program, registration, check-in and orders (`conferenceFactsTx`), and leads, sponsor deliverables and badge printers through `AlertDeps.conference` (`ConferenceSources`; a missing port or a `null` answer keeps the rule quiet). Group `conference`. Nothing fires once an event wraps.
