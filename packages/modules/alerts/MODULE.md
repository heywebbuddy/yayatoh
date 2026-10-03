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
- **Social pack (M4.6a):** three event rules read the guest list (guests' `socialFactsTx`, counts only) and seating's guest plan (`guestPlacesTx`, through the `OccupantDirectory` port each composition root registers, the worker included). `rsvpPending`: invited guests with an invitation still unanswered (gala seat holders and guests invited to nothing aside), from RSVP deadline −7 d (warning) and −1 d (critical) until the event starts; params `parties` and `days`. `guestsUnseated`: guests who haven't declined without a table on a guest chart, in the last 7 days (critical in the last day and while the event runs). `mealsMissing`: attending guests without a meal when the event has a menu, in the last 7 days. All `attendees` group, `guests:read`. `guests.party_responded@1` and `guests.rsvp_deadline_set@1` re-evaluate the event; the full sweep also takes events whose RSVP deadline is in the last 120 days or the next 8 (`rsvpDeadlineEventIdsTx`; `alerts.orgs_to_evaluate` likewise), so a wedding two months out is watched at deadline −7 d.
- **Organizer rules (M6.2b).** Rule keys `metricRule` (sales group, `orders:read`) and
  `metricRuleFinance` (payments group, `finance:read`), scope `m:{ruleId}`, title = the rule's
  name. Driven only by `analytics.alert_rule_evaluated@1` (analytics is the same tier); the sweep
  wakes snoozes and times out acknowledgements from the stored reading. Sent in the app, by email
  and by push (never text) as `alerts.metric` (waits out quiet hours in the recipient's time zone)
  or `alerts.metric-now`.
