# automations (tier 6)

Journeys (M3.7a): an org's automation for one event (or every event of a series). Owns Postgres
schema `automations`: `journeys`, `journey_steps`, `journey_runs` (one person's way through a
journey) and `scheduled_actions` (the work queue, one row per run and step).

**Invariants**
- A journey has one trigger: `order_paid` (the buyer), `checked_in` (the ticket's holder) or
  `event_time` (everyone on the event's list, enrolled by the runner). `rsvp` is reserved for
  M4.1d (`FUTURE_TRIGGERS`): a new trigger is a subscriber that calls `journeysForEventTx` +
  `enrollTx`, plus the value in `journeys_trigger_check`.
- Each step = a wait (from the trigger, the event's start or its end: calendar days in the event's
  timezone at the same wall-clock time or at `at_time`, then exact minutes; DST-safe) + an action
  (email, SMS, WhatsApp or push message; add a label; survey invite) + an optional condition
  (checked in, has a seat, answered the survey, or their negations), checked when the step is due.
- Steps are edited only while the journey is off. Switching it on never enrolls anyone
  retroactively; switching it off cancels every pending step (`journey_disabled`).
- One run per (journey, event, contact). On enrollment every step gets a `scheduled_actions` row
  with its time; a step whose time has passed is `skipped` (`too_late`), except steps that wait
  from the trigger.
- **Exactly once:** `scheduled_actions.idempotency_key` (journey + step + event + contact) is
  unique per org and is the message's notifications dedupe key. The runner claims a due row with
  `FOR UPDATE SKIP LOCKED` while `pending` and commits the step's effect with the row's new status.
  A failed attempt rolls back entirely and is retried with backoff (1, 5, 15, 60 min); after 5
  attempts (or a permanent error) the step is `failed` and `automations.journey_step_failed@1`
  `{ orgId, journeyId, runId, actionId, eventId, position, action, attempts, error }` is emitted.
  **The M3.2b alert engine subscribes to it** for its "automation failures" rule (not wired here).
- **`replayed` events never trigger journeys:** none of the subscribers accepts replayed history,
  and each handler checks the flag again.
- Cancellation hooks: a full refund (`order.refunded@1`, `fully`) cancels the runs its order
  started; a cancelled ticket or guest spot cancels the person's runs once they hold nothing at the
  event; a cancelled event or date cancels its runs.
- Reschedule on date change (`event.updated/rescheduled/postponed/occurrences_updated`): pending
  steps are re-planned from the event's current start/end (never from the change, so replays land
  on the same result); trigger-anchored steps keep their time; past-due steps run now while their
  anchor is ahead, else are skipped; steps that ran never run again. A postponed event parks its
  event-anchored steps (`cancelled` / `event_postponed`) until it is rescheduled.
- Messages go through the notifications dispatcher as `automations.message` (category reminders:
  preferences, unsubscribe, quiet hours, texts need consent) on the step's own channel; subject and
  body are the organizer's, with `{name}`, `{event}` and `{when}` filled per person.
- Reads need `marketing:read` (viewers included); writes need `marketing:write`. The runner's
  commands need `platform:automations.run` (system actors only).
- Execution: the worker's leader finds orgs with due work through
  `automations.orgs_with_journey_work()` (SECURITY DEFINER, ids only, platform_reader) and queues
  the pg-boss job `automations.run-due` (exclusive per org); the dev drain runs the same pass.
