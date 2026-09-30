# Spec: M3.9 — Surveys v1

- **Milestone:** M3.9 (roadmap §10 Phase 3, "M3.9 Surveys v1 (S)"; Phase 3 plan `docs/plans/phase-3.md`, Wave A)
- **Status:** M3.9a built (2026-09-28); the journey step is consumed by M3.7a
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0015 (event times in the event's zone), 0018 (tokens only)

## M3.9a — post-event surveys, session feedback, signed single-use links, NPS (done)

### 1. Goal and users
Organizers ask the people who came to an event (or to one program session) what they thought, and
read a response rate, an NPS and a summary per question. Attendees answer from a personal link in
their email, on a phone, without an account, once.

### 2. References
- **Vision:** "Engage: … surveys, polls …" (§5 Enterprise) and the five-step journey ending in a post-event survey (§8).
- **Roadmap:** M3.9 ("post-event survey and session feedback on the forms engine; signed single-use links; journey step After event → Survey; response reporting and NPS"; acceptance "one response per person; reminders stop once answered").
- **Legacy evidence:** none (Eventmie Pro has no surveys).

### 3. Scope
**In (built):**
- New module `@yayatoh/surveys` (tier 5, schema `surveys`). A survey is a **post-event survey** (one per event) or **session feedback** (one per program session). Its questions are a form in the forms engine (kind `survey`, subject `survey` + id), versioned there.
- Forms engine: two new question types for surveys, **`nps`** (0–10) and **`rating`** (1–5); checkout questions refuse them, surveys refuse sensitive answers. `submitResponseTx` returns the stored response; new `subjectResponsesTx` (all responses of a subject, with the questions to report).
- Console (Marketing → Surveys, `/o/{org}/e/{event}/marketing/surveys`): create the post-event survey or a session's feedback (a translated starting set: NPS, overall rating, "what could we do better?"); edit title and introduction; add questions (all forms types plus rating and NPS), reorder with ↑/↓ buttons (the keyboard alternative to dragging), remove; send; sends log; results; CSV export; close/reopen.
- **Sending:** once the event (or session) has ended, to everyone attending or **only people who checked in** (a live admission of any of their tickets). One invitation per **person** (`contact_id`): a buyer of three tickets is asked once; sending again reaches only people not yet asked. Optional **reminder after N days (1–30)**; links valid for 1–90 days (default 30). Idempotent (Idempotency-Key minted when the page renders) and refused while staff paused messaging.
- **Emails** through the notifications dispatcher: kinds `surveys.invite` and `surveys.reminder`, 13 locales. **Category `event_updates`** (see §11). The reminder is queued with its send time; answering cancels it (`answered`), closing the survey cancels the rest (`survey_closed`); the mailer also skips reminders of people who answered before it ran.
- **Signed single-use links** `/survey/{invitationId}~{hmac}` (purpose `surveys.invitation`), on the marketplace or any tenant host. Mobile-first page, 13 locales, Arabic right to left: NPS and ratings as large pill radios (44 px, arrow keys), every forms type, errors named per question and focused, answers kept when something needs fixing. States: open, **thank you**, **already answered**, **expired**, **closed**.
- **One response per person, enforced in the database:** the invitation row is locked while answering, and `surveys.responses` is unique per (survey, contact) and per invitation; the loser of a race gets `conflict / already_answered`.
- **Reports:** asked, answered, response rate, NPS (promoters 9–10, passives 7–8, detractors 0–6; % promoters − % detractors, rounded half away from zero), per question: score distributions (bar chart + data table), averages, choice counts with %, yes counts, number min/max/average, the 20 latest text answers. Questions removed after people answered them stay in the report; ones nobody answered do not.
- **CSV export** of the answers (name, email, answered at in the event's zone, one column per question) through the bulk framework: `attendees:export`, a recent step-up, audited as `bulk.start` (`surveys.responsesCsv`), CSV-injection-safe.
- **Journey step for M3.7a:** `sendSurveyStepTx(tx, ctx, emit, eventId, { attendeeId }, opts)` (and `sendSurveyStepCommand`): invites one attendee to the event's post-event survey inside the journey's transaction; returns `invited` or `skipped` with a reason (`no_survey`, `closed`, `no_questions`, `not_attending`, `already_invited`), never throws for those.

**Out / Later:**
- Anonymous surveys (v1 ties each answer to the invited person, which the export shows).
- Surveys for people with a session enrollment (M5.2) — session feedback goes to the event's attendees (or those checked in).
- Changing the reminder or link lifetime after sending; reopening a closed survey does not queue canceled reminders again.
- Erasing survey answers in data-subject requests (M1.14c): answers are keyed by invitation and the attendee's name/email are redacted by attendee erasure, but free-text answers stay. **Next increment.**
- Staff impersonation (M1.2e) is not built yet; when it is, the survey export must be in the `export` category it blocks (it already goes through the same bulk-export path as the other exports).
- A tenant host refusing another org's survey token (the token alone decides the org, as for reply links).
- SMS/WhatsApp survey links (M3.5b providers).

### 4. `touches:`
```yaml
touches:
  - packages/modules/surveys/**
  - packages/modules/forms/src/{definition,forms,index,schema,ui}.ts
  - packages/modules/forms/tests/definition.test.ts
  - packages/modules/notifications/src/{kinds,reminders,index}.ts
  - packages/modules/notifications/src/templates/**
  - packages/modules/notifications/tests/__snapshots__/render.test.ts.snap
  - packages/modules/program/src/index.ts
  - packages/db/drizzle/0054_brave_zaran.sql (+ meta)
  - packages/testing/{package.json,src/fixtures.ts,src/ports.ts,tests/surveys.int.test.ts}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/marketing/**
  - apps/web/src/app/[locale]/survey/**
  - apps/web/src/components/{survey-forms,survey-answer-form}.tsx
  - apps/web/src/server/{bulk,notifications}.ts
  - apps/web/messages/*.json
  - apps/web/e2e/surveys.spec.ts
  - apps/worker/{package.json,src/bulk.ts,src/registry.ts}
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `surveys.surveys` | new | event, kind, session (feedback only), title, intro, `closed_at`. Partial uniques: one post-event survey per event, one per session. FKs → `events.events`, `program.sessions` (cascade). |
| `surveys.sends` | new | one row per send: source (`console`/`journey`), audience, reminder days, link days, recipients. |
| `surveys.invitations` | new | one per (survey, contact); attendee, `expires_at`, `remind_at`, `responded_at`. FK → `attendees.attendees`. |
| `surveys.responses` | new | the one response per person: unique (org, survey, contact) and (org, invitation); the form version answered. |
| `forms.forms`, `forms.form_responses` | widened CHECKs | kind `survey`, subject `survey`, respondent `survey_invitation`. |

**RLS notes:**
- [x] Tenant tables use `tenantTable()` (org-leading indexes, composite FKs, org-scoped uniques)
- [x] New tables registered in the isolation fixtures (`createOrgFixture`: a survey sent the day after the fixture event and one answer)
- [x] Cross-tenant lookup only through `surveys.invitation_org(uuid)` (SECURITY DEFINER, returns the org id only)

**Migration `0054_brave_zaran.sql`:** new schema and tables (generated), plus hand-written blocks: the three widened forms CHECKs as `NOT VALID` + `VALIDATE CONSTRAINT`; composite FKs to `events.events`, `program.sessions`, `attendees.attendees`; `surveys.invitation_org()` with `REVOKE ALL … FROM PUBLIC` and `GRANT EXECUTE … TO app_user`. Nothing destructive.

### 6. API diff
- **`/v1`:** none.
- **Commands (entitlement `messaging`):** `surveys.createSurvey`, `surveys.updateSurvey`, `surveys.saveQuestions`, `surveys.setClosed`, `surveys.sendSurvey` (idempotent), `surveys.sendSurveyStep` — `messages:send`; `surveys.submitResponse` — `public:survey` (the signed token is the credential); queries `surveys.listSurveys`, `surveys.getSurvey`, `surveys.targets` — `messages:read`; export `surveys.startResponsesCsv` — `attendees:export` + step-up. Event-scoped roles apply (inputs carry `eventId`).
- **`/api/v2`:** none.

### 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `survey.sent` | 1 | `sendSurvey`, `sendSurveyStepTx` | `surveys.mailer` (worker + dev drain) | no |
| `survey.responded` | 1 | `submitResponse` | none yet (M3.7a journeys, M3.8 analytics) | no |

### 8. Entitlements and flags
- **Module key:** `messaging` (like announcements; no new key).
- **Kill switch:** staff `pause_messaging` refuses sending (and the dispatcher holds queued mail).

### 9. ELT impact
None (the legacy platform has no surveys).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-9a-01 | NPS buckets and score (−100…100, half away from zero), response rate, per-question summaries and CSV cells are exact | `packages/modules/surveys/tests/report.test.ts` (unit) |
| AC-9a-02 | Survey links are HMAC-signed per purpose; tampered ids, signatures or secrets are refused | `packages/modules/surveys/tests/links.test.ts` (unit) |
| AC-9a-03 | NPS takes 0–10 and ratings 1–5 whole scores; scales have no range or options; checkout questions refuse scales; surveys refuse sensitive answers | `packages/modules/forms/tests/definition.test.ts` (unit), `surveys.int.test.ts` |
| AC-9a-04 | One post-event survey per event, session feedback needs a session of the event; viewers and other orgs are refused | `packages/testing/tests/surveys.int.test.ts`, `apps/web/e2e/surveys.spec.ts` |
| AC-9a-05 | Sending waits for the end of the event/session, needs questions and people, refuses viewers and a paused org; checked-in only reaches people with an admission | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-06 | Each person is invited once, a replayed key or relay sends nothing twice, and each email carries their own signed link (unsubscribable) | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-07 | **One response per person:** of two simultaneous answers exactly one wins; a direct second row is refused by the database; a second attempt from the page is refused | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-08 | **Reminders stop once answered:** the responder's queued reminder is canceled (`answered`); only non-responders are reminded | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-09 | Expired links and closed surveys refuse answers and say so; reopening works | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-10 | Results show asked/answered/rate, NPS with its buckets and per-question summaries (charts with data tables); viewers are refused | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-11 | The CSV export needs a recent step-up and `attendees:export`, is audited, and lists one row per answer with every reported question | `surveys.int.test.ts`, `surveys.spec.ts` |
| AC-9a-12 | The journey step invites once and skips without a survey (`sendSurveyStepCommand`) | `surveys.int.test.ts` |
| AC-9a-13 | Tenant isolation: every surveys table has rows for both fixture orgs and none leak | `packages/testing/tests/isolation.int.test.ts` |
| AC-9a-14 | Every validation message, empty state, the keyboard path (create, reorder, send, NPS arrows), axe on every new screen and state, and Arabic right to left (guest page and console) | `apps/web/e2e/surveys.spec.ts` |
| AC-9a-15 | Viewers see no Marketing section and get 404 for survey URLs; box office reads results with no build/send/export/close controls | `surveys.spec.ts` |
| AC-9a-16 | Survey emails render in all 13 locales | `packages/modules/notifications/tests/render.test.ts` (snapshots) |

### 11. Security and privacy
- **Category choice (pending the owner's confirmation):** survey emails are `event_updates`, not `transactional` and not `marketing`. They go to people who attended one event, about that event, from its organizer — a relationship message like guest emails and announcements — so no marketing consent is required, but they are never forced through like tickets: the event-updates preference, one-click unsubscribe, address suppressions, quiet hours and the org pause all apply. If the owner prefers `marketing` (consent-gated), it is a one-line change in `kinds.ts`.
- The public page and command take the org from the signed invitation id (definer function), never from the request; the page output is an allowlist (`PublicSurveyDto`: no ids, no org internals). The audit row of an answer has no answers in it.
- Reports and the export show answers with the respondent's name and email to `messages:read` / `attendees:export` roles; surveys have no sensitive answers (refused on save).

### 12. Performance budget
A send resolves the event's active attendees in one query and inserts invitations in one statement (max 10,000 people per send); emails are queued by the worker. Reports read the survey's responses once (fine to tens of thousands; a normalized `form_answers` table is the M3+ path if needed).

### 13. Rollout
Behind the `messaging` entitlement; no flag. Worker registers `surveys.mailer` and the export action.

### 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | M3.9a surveys v1 | this spec | db-migration, tenancy |
| 2 | M3.9b | survey answers in DSAR export/erasure; anonymous option; M3.7a journey wiring | privacy |

### 15. Demo checklist
- [ ] Lakeside console → a past event → Marketing → Open surveys → Create the post-event survey; add a "Best part" choice question; move it up.
- [ ] Add three guests; send to everyone with a reminder after 2 days.
- [ ] `/dev/mailbox`: open one guest's link, answer (try sending empty first), see "Thank you!"; open it again: "Already answered".
- [ ] Drain with scheduled messages: only the guests who did not answer get "Reminder: …".
- [ ] Results: response rate, NPS and per-question summaries; Download answers (CSV) after "Confirm it's you".

### 16. Owner tasks
- [ ] Confirm survey emails as `event_updates` (not marketing), §11.
