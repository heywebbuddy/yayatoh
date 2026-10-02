# Spec: M3.7 — Automations and journeys

- **Milestone:** M3.7 (roadmap §10 Phase 3, "M3.7 Automations and journeys (M)"; Phase 3 plan `docs/plans/phase-3.md`, Wave C)
- **Status:** M3.7a built (2026-09-29); local gate green (`pnpm verify`, journeys e2e 12/12, web suite 1426 passed + 1 load timeout that passes on rerun)
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0008 (outbox, `replayed` history never fires side effects), 0015 (event times in the event's zone), 0018 (tokens only)

## M3.7a — journeys: triggers, scheduled actions, vision template, cancellation, reschedule, run history (done)

### 1. Goal and users
Organizers (owners, admins, managers, marketing) set up a journey once per event (or series) and it
talks to every buyer or attendee at the right moments: a confirmation, reminders by email and text,
a push on the day, the survey afterwards. Viewers and finance can read journeys and their history.

### 2. References
- **Vision:** the five-step journey (purchase → confirmation, T−7 d reminder, T−24 h SMS/WhatsApp, event-day push, post-event survey).
- **Roadmap:** M3.7 ("pg-boss `scheduled_actions` journeys; triggers purchase, check-in, time relative to the event (RSVP in M4.1); vision template; cancellation hooks; reschedule on date change; run history; failure alerts"; acceptance: time-travel test sends 5 messages at the right offsets, a date change reschedules pending steps, retries never duplicate sends, backfilled `replayed` events never trigger a journey).
- **Legacy evidence:** none (Eventmie Pro has fixed reminder emails only).

### 3. Scope
**In (built):**
- New module `@yayatoh/automations` (tier 6, schema `automations`, `MODULE.md`). Tables `journeys`, `journey_steps`, `journey_runs`, `scheduled_actions`.
- **Journey** = event *or* series + trigger + ordered steps, off until switched on. **Triggers:** `order_paid` (the buyer, from `order.paid@1`), `checked_in` (the ticket's holder, from `ticket.admitted@1`), `event_time` (everyone on the event's list, enrolled by the runner each pass; people added later join on the next pass). **Extension point:** `FUTURE_TRIGGERS = ['rsvp']`; M4.1d adds a subscriber that calls `journeysForEventTx` + `enrollTx` and widens `journeys_trigger_check`.
- **Step** = wait + action + optional condition. Wait: from the trigger, the event's start or its end (a date's start/end on multi-date events), **calendar days in the event's time zone at the same wall-clock time** (DST-safe), an optional time of day (`09:00`), then exact hours/minutes. Actions: send an **email, SMS, WhatsApp or push** message (organizer subject + body with `{name}`, `{event}`, `{when}`), **add a label** to the person's attendee records, **invite to the post-event survey** (M3.9a `sendSurveyStepTx`). Conditions (checked when due): checked in / not, has a seat / not, answered the survey / not.
- **`scheduled_actions`**: one row per run and step, with `idempotency_key` = journey + step + event + contact, unique per org and reused as the notifications dedupe key. Executed by the pg-boss job **`automations.run-due`** (worker; exclusive queue per org; the leader queues it every 5 s for orgs from `automations.orgs_with_journey_work()`), and by the dev drain in dev/CI. Each step runs in its own transaction (`FOR UPDATE SKIP LOCKED`, only while `pending`); a failed attempt rolls back entirely, is retried after 1, 5, 15, 60 min, and is `failed` after 5 attempts (at once for permanent errors).
- **Failure alerts:** a failed step emits **`automations.journey_step_failed@1`** `{ orgId, journeyId, runId, actionId, eventId, position, action, attempts, error }` to the outbox. The M3.2b alert engine (merged in parallel) should subscribe to it for its "automation failures" rule; no alert-engine code is imported here.
- **Vision journey template** (created in the organizer's language from the console messages): confirmation email at purchase; reminder email 7 days before the start; SMS 1 day before (switchable to WhatsApp); push on the event day at 09:00; survey invitation the morning after the event ends at 10:00.
- **`replayed` events never trigger:** none of the three subscribers accepts replayed history (skipped by `consumeEvent`) and each handler checks the flag again.
- **Cancellation hooks:** full refund (`order.refunded@1` `fully`) → the runs that order started; `tickets.cancelled@1` / `attendee.cancelled@1` → the person's runs once they hold nothing at the event; `event.cancelled@1` / `event.occurrence_cancelled@1` → every run for it. Pending steps become `cancelled` with the reason; what ran stays.
- **Reschedule on date change** (`event.updated`, `event.rescheduled`, `event.postponed`, `event.occurrences_updated`): pending event-anchored steps are re-planned from the event's current start/end (never from the change), so replays land on the same result; trigger-anchored steps keep their time; a step whose new time passed runs now while its anchor is ahead, else is skipped `too_late`; a postponed event parks its steps (`event_postponed`) and the reschedule brings them back; steps that ran never run again (their key is spent).
- **Enrollment:** one run per (journey, event, contact) — a second purchase never enrolls twice; a step whose time has already passed when someone joins is `skipped` (`too_late`) unless it waits from the trigger.
- **Run history** per journey (people, joined, status, "n of m done", next step; search by name or email; keyset pages of 50) and per person (every step with its planned time, status and result).
- **Console** (Marketing → Journeys, `/o/{org}/journeys`): list with status, trigger, steps and people; **New journey** (name, event or series, the vision template or blank + trigger); **journey page**: switch on/off, the step editor while off (native controls, **Move up / Move down / Remove** buttons instead of dragging, focus follows the moved step, a plain-language summary of each wait), read-only steps with counts while on or for readers, run history; **run page** per person; delete a journey that never enrolled anyone. 13 locales, Arabic right to left, strict CSP (no inline styles).
- **Notifications:** new kind `automations.message` (category `reminders`, 13 locales, sample params); journey messages go through the existing dispatcher, policy gate and dev/fake transports (M3.5b provider adapters are not assumed).

**Out / Later:**
- RSVP trigger (M4.1d), segment/audience triggers and "wait until" conditions (M3.8+).
- Editing a journey while it is on (steps are planned at enrollment; today: switch off, edit, switch on).
- Per-step channel fallback (e.g. WhatsApp else SMS), A/B branches, goal exits.
- A tickets link in journey messages (the order's manage link lives in orders; the platform's tickets email still carries it).
- Wiring the alert rule itself (M3.2b's side).
- Automations on `/v1` (none).

### 4. `touches:`
```yaml
touches:
  - packages/modules/automations/**
  - packages/modules/notifications/src/{kinds.ts,templates/messages/*.json,templates/samples.ts}
  - packages/modules/attendees/src/{attendees,index}.ts        # addAttendeeLabelsTx
  - packages/modules/crm/src/{contacts,index}.ts               # contactsByIdsTx, contactIdsMatchingTx
  - packages/modules/orders/src/participation.ts               # orderRefTx: occurrence, status, locale
  - packages/modules/surveys/src/{surveys,index}.ts            # answeredEventSurveyTx
  - packages/db/drizzle/0076_violet_shotgun.sql (+ meta)
  - packages/testing/{package.json,src/fixtures.ts,src/canary/registry.ts,tests/journeys.int.test.ts}
  - apps/worker/{package.json,src/journeys.ts,src/main.ts,src/registry.ts,tests/journeys.int.test.ts}
  - apps/web/src/app/[locale]/o/[org]/(org)/{layout.tsx,journeys/**}
  - apps/web/src/components/{icons,journey-editor}.tsx
  - apps/web/src/lib/journeys.ts
  - apps/web/src/server/notifications.ts                       # dev drain runs journey steps
  - apps/web/messages/*.json
  - apps/web/e2e/journeys.spec.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `automations.journeys` | new | name, `event_id` xor `series_id`, trigger, enabled (+ `enabled_at`), template. FKs → `events.events`, `events.series` (cascade). |
| `automations.journey_steps` | new | position (unique per journey), anchor, offset days/minutes, `at_time`, action, subject/body/label, condition. CHECKs for vocabularies, ranges and required copy. |
| `automations.journey_runs` | new | one per (journey, event, contact): occurrence, order, trigger, `triggered_at`, locale, status (`active`/`completed`/`cancelled`) + reason. FK → `events.events`. |
| `automations.scheduled_actions` | new | one per (run, step): `idempotency_key` unique per org, `scheduled_for`, `due_at`, status (`pending`/`done`/`skipped`/`failed`/`cancelled`), attempts, outcome, `last_error`. Partial indexes on due pending rows (per org, and `(due_at, org_id)` for the finder). |

**RLS notes:**
- [x] Tenant tables use `tenantTable()` (org-leading indexes, composite FKs, org-scoped uniques); ENABLE + FORCE RLS and the NULLIF policy (generated)
- [x] New tables registered in the isolation fixtures (`createOrgFixture`: a switched-on journey for the fixture event; the fixture's paid order enrolls the buyer → a run and two scheduled actions)
- [x] Column privacy declared (`src/private-columns.ts`, registered in the canary registry)
- [x] Cross-tenant: only `automations.orgs_with_journey_work(int)` (SECURITY DEFINER, org ids only, `platform_reader`)

**Migration `0076_violet_shotgun.sql`** (renumbered at merge): generated schema, tables, indexes, RLS and policies, plus one hand-written block:
1. `journeys_event_fk` (org_id, event_id) → `events.events` ON DELETE CASCADE
2. `journeys_series_fk` (org_id, series_id) → `events.series` ON DELETE CASCADE
3. `journey_runs_event_fk` (org_id, event_id) → `events.events` ON DELETE CASCADE
4. `automations.orgs_with_journey_work(p_limit)` SECURITY DEFINER (`search_path = pg_catalog`), `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO platform_reader`.
New tables only; nothing destructive.

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Commands** (entitlement `marketing`): `automations.createJourney`, `automations.updateJourney`, `automations.setJourneyEnabled`, `automations.deleteJourney` (category `delete`) — `marketing:write`; queries `automations.listJourneys`, `automations.journey`, `automations.journeyRuns`, `automations.journeyRun` — `marketing:read`. Runner (system actors only, `platform:automations.run`): `automations.runScheduledAction`, `automations.recordStepFailure`, `automations.enrollEventTime`.

### 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `automations.journey_step_failed` | 1 | `recordStepFailure` | the M3.2b alert engine ("automation failures") — to be wired there | no |
| consumed: `order.paid`, `ticket.admitted` | 1 | orders, checkin | `automations.journey-triggers` | — |
| consumed: `order.refunded`, `tickets.cancelled`, `attendee.cancelled`, `event.cancelled`, `event.occurrence_cancelled` | 1 | orders, attendees, events | `automations.journey-cancellations` | — |
| consumed: `event.updated`, `event.rescheduled`, `event.postponed`, `event.occurrences_updated` | 1 | events | `automations.journey-rescheduler` | — |

### 8. Entitlements and flags
Module key `marketing` (with audiences and tracked links). No flag: journeys are off until an organizer switches one on. Staff `pause_messaging` still holds the messages in the dispatcher.

### 9. ELT impact
None; migrated history is `replayed` and never enrolls anyone.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-7a-01 | Offsets in the event's zone across DST: T−7 d is 169 h across fall-back and 167 h across spring-forward, a missing wall time moves past the gap, an ambiguous one takes the earlier instant; `at` times, minutes, the unknown-zone fallback | `packages/modules/automations/tests/journeys.test.ts` (unit) |
| AC-7a-02 | Condition evaluation (all six), step validation, placeholders, planning (`too_late`, run now), retry backoff, the vision template's shape | `journeys.test.ts` (unit) |
| AC-7a-03 | **Time travel: the vision journey sends exactly 5 messages at the right offsets** (confirmation, T−7 d email, T−24 h SMS, event-day push, survey invite) — nothing a minute before each, each exactly at its time, still 5 two months later | `packages/testing/tests/journeys.int.test.ts` |
| AC-7a-04 | **A date change reschedules pending steps** (same wall-clock time), replays change nothing, steps that ran never re-send; moving the event closer runs an overdue step now; postponing parks and rescheduling restores | `journeys.int.test.ts` |
| AC-7a-05 | **Retries never duplicate:** a doubled `order.paid`, two runners at once, a row forced back to pending, a failed attempt then its retry — one message each | `journeys.int.test.ts` |
| AC-7a-06 | **`replayed` events never trigger** (nor cancel) | `journeys.int.test.ts` |
| AC-7a-07 | A full refund cancels the order's pending steps; cancelling the event cancels every run's pending steps | `journeys.int.test.ts` |
| AC-7a-08 | **A failing step raises the alert event** after 5 attempts (at once when permanent), the other steps still run | `journeys.int.test.ts` |
| AC-7a-09 | Check-in trigger, the label action, conditions checked when due; no phone / no device / no survey are skipped with a reason; a second purchase never enrolls twice; `event_time` enrolls everyone and late additions | `journeys.int.test.ts` |
| AC-7a-10 | Building: validation, edit only while off, step ids kept across reorder, switching off cancels pending steps and stops enrollment, delete only without history | `journeys.int.test.ts` |
| AC-7a-11 | Permissions and isolation: viewers read but never write, users cannot run steps, another org sees and touches nothing; every table has rows for both fixture orgs | `journeys.int.test.ts`, `packages/testing/tests/isolation.int.test.ts` |
| AC-7a-12 | pg-boss: one `automations.run-due` job per org at a time; the queued job runs the due step once; the finder is audited as `system:journeys`; the worker composes the three subscribers | `apps/worker/tests/journeys.int.test.ts` |
| AC-7a-13 | e2e: create the vision journey from the template (keyboard, validation messages), switch it on, buy a ticket, the confirmation arrives (dev mailbox), run history per journey and per person shows the scheduled steps, search, reload, switch off cancels waiting steps; axe on every screen | `apps/web/e2e/journeys.spec.ts` |
| AC-7a-14 | e2e: step editor with the keyboard (add, validation, reorder with focus following, remove, save, reload), switching on with no steps refused, delete | `journeys.spec.ts` |
| AC-7a-15 | e2e: a viewer reads the journey (no switch, no editor) and gets 404 on New journey; Arabic right to left on list, journey and new pages | `journeys.spec.ts` |
| AC-7a-16 | The new message kind is labelled and rendered in all 13 locales | `apps/web/tests/notification-kinds.test.ts`, `packages/modules/notifications/tests/render.test.ts` |

### 11. Security and privacy
- Journey messages are organizer copy sent on the organizer's behalf as `reminders`: preferences, one-click unsubscribe, address suppressions, erased addresses, quiet hours, text consent and the org pause all apply (dispatcher). See the owner inbox for the category choice.
- Run history shows people's names and emails to `marketing:read` roles (viewers included, as for audiences' previews); DTOs are allowlists; `idempotency_key` and `last_error` never leave the server. The failure event carries an error code, never message text.
- The runner and the finder never take an org from input: the finder is SECURITY DEFINER (ids only), each org's work runs under that org's RLS.

### 12. Performance budget
Enrollment writes one run and ≤ 20 action rows. The runner claims due rows through a partial index and runs ≤ 500 per job; `event_time` enrollment skips people already enrolled (one query per event) — fine to tens of thousands of attendees per pass.

### 13. Rollout
Behind the `marketing` entitlement; every journey starts off. The worker registers the subscribers and the job; the dev drain runs journey steps for e2e.

### 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | M3.7a journeys | this spec | db-migration, tenancy |
| 2 | M3.7b | RSVP trigger (with M4.1d), live editing with re-planning, channel fallback, alert rule wiring check with M3.2b | — |

### 15. Demo checklist
- [ ] Lakeside console → Journeys → New journey → pick an event a month out → The vision journey → Create; read the five steps.
- [ ] Switch on; buy a ticket on the public page; Drain (`/api/dev/outbox/drain`) → the dev mailbox has "You're in: …".
- [ ] Back on the journey: the buyer is "In progress", "1 of 5 done"; open them: the four waiting steps with their planned times.
- [ ] Switch off: "4 waiting steps were cancelled". Edit a step (move the SMS above the reminder, change it to WhatsApp), save, switch on again.

### 16. Owner tasks
- [ ] Confirm the journey defaults listed in `docs/owner-inbox.md` ("Journey defaults, pending owner").
