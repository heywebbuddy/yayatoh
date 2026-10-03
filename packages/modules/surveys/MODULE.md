# surveys (tier 5)

Post-event surveys and session feedback (M3.9a). Owns Postgres schema `surveys`. Questions live in
the forms engine (form kind `survey`, subject `survey` + the survey id): versioned there, answers
validated there, stored in `forms.form_responses` (respondent `survey_invitation`).

**Invariants**
- One post-event survey per event and one feedback survey per program session (partial unique
  indexes). Composite FKs to `events.events`, `program.sessions` and `attendees.attendees` (lower
  tiers) are hand-written in the migration.
- Surveys go out only once their event (or session) has ended, to the event's active attendees or
  only those with a live admission, one invitation per **person** (`contact_id`) per survey.
  Sending again reaches only people not yet invited. `messaging` pause (M1.3e) blocks sending.
- A survey link is `<invitationId>~<hmac>` (purpose `surveys.invitation`); nothing secret is stored.
  The org comes from the signed invitation id via `surveys.invitation_org()` (SECURITY DEFINER,
  ids only), never from the request.
- **One response per person:** the invitation row is locked while answering, and
  `surveys.responses` is unique per (survey, contact) and per invitation; a second attempt is
  `conflict` / `already_answered`. Links expire (`expires_at`, 1–90 days) and stop when the survey
  is closed.
- Emails go through the notifications dispatcher as `surveys.invite` / `surveys.reminder`
  (category `event_updates`: preferences, unsubscribe, quiet hours and the pause apply). Dedupe keys
  `survey-invite:{invitationId}` / `survey-reminder:{invitationId}`. A reminder is queued for its
  time; answering cancels it (`answered`), closing the survey cancels the rest (`survey_closed`).
- Reports (NPS, response rate, per-question summaries) need `messages:read`; building and sending
  need `messages:send`; the CSV export (names and emails) needs `attendees:export` and a recent
  step-up, like every export.
- `sendSurveyStepTx` is the journey step "After event → Survey" (M3.7a): it never throws for a
  missing/closed survey or an already-invited person, it reports why it skipped.
- **Session-end prompt (M5.7b).** `feedbackPromptQuery` / `openFeedbackCommand` (`public:survey`):
  once a session feedback survey can be answered (open, with questions, its session over, the
  event published and public), the signed-in attendee (the actor must be the `account`; contact by
  account link, else email; an active attendee) gets their invitation: the existing one, or a new
  one recorded as a `prompt` send without an email. Answered → `conflict` / `already_answered`;
  an expired emailed link → `invalid_state` / `expired`. `survey.responded@1` carries `contactId`
  and `sessionId` (engagement scores).
