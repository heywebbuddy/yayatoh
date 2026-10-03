# Spec: M5.7 — Live engagement

- **Milestone:** M5.7 (roadmap Phase 5, "M5.7 Live engagement"; Phase 5 plan `docs/plans/phase-5.md`, Wave 2: M5.7a, Wave 3: M5.7b)
- **Status:** M5.7a built (2026-10-02); M5.7b (session feedback and the engagement score) built (2026-10-03)
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** M3.1b (realtime publisher: SSE, reconnect snapshot), M1.4f / M5.2a (program sessions), M1.14a (strict CSP, rate limits), ADRs 0008 (outbox), 0009 (realtime); owner decisions P5-1 (behind the `sessions` module key), P5-2/P5-3 (in-house realtime)

## M5.7a — Polls and Q&A (done)

### 1. Goal and users
Conference organizers run live polls and moderated Q&A in each session, without a third-party
tool. **Moderators** (owners, admins, managers, event managers: `events:write`) turn polls and Q&A
on for a session, write polls, open and close them, show or hide results, put a poll and a question
on stage, and approve, dismiss or answer questions. **Viewers** (`events:read`) follow along
read-only. **Attendees** take part from their phone, without an account, from the public agenda or
a QR code: they vote, ask (by name or anonymously) and upvote. **Speakers** follow the presenter
view; the **room's projector** shows the big screen through a signed link (no sign-in), with high
contrast and reduced motion modes.

### 2. References
- **Phase 5 plan:** Wave 2 row M5.7a ("server-authoritative polls … moderated Q&A … participant,
  moderator, presenter and big-screen views; signed display link"; acceptance "one vote per person
  per poll under concurrency; unapproved questions never reach public payloads (leak crawler)").
- **Research:** `docs/research/34-gap-engagement.md` §3 (server-authoritative votes, moderation,
  four web views, token-protected big screen). Ably is replaced by the M3.1b publisher (P3-3).
- **Legacy evidence:** none (Eventmie Pro has no polls or Q&A).

### 3. Scope (built)
**Module `engagement`** (`packages/modules/engagement`, tier 5, schema `engagement`, `MODULE.md`):
- `session_settings`: one row per session with live engagement on: Q&A open, anonymous questions
  allowed, who may see the name behind an anonymous question (`hidden` default, or `moderators`),
  the display-link version, and what is on stage (`live_poll_id`, `pinned_question_id`).
- `polls` (single choice, multiple choice with `max_choices`, rating 1…`rating_scale`, word cloud),
  states draft → open → closed (forward only), `show_results`, `ballots`; options as
  `[{ id: 'o1', label }]` jsonb. `poll_ballots` (one per participant per poll, **no choice kept**)
  and `poll_tallies` (counts per option id, rating value or normalized word; at most 300 distinct
  words, the top 50 shown).
- `questions` (pending → approved | dismissed; `answered_at` on approved ones; `upvotes`; the name
  only when given and allowed) and `question_upvotes` (one per participant per question).
- **Participants are keys, not people:** `participant_key` = HMAC (app token secret) of the
  signed-in user's id or the `yy_did` device cookie, scoped to the session.
- Commands (`tenantCommand`, the 10-step pipeline): `enableLive`, `updateSettings`,
  `rotateDisplayLink`, `createPoll`, `openPoll`, `closePoll`, `setPollResults`, `presentPoll`,
  `deletePoll` (category `delete`), `moderateQuestion` (approve, dismiss, answer, unanswer),
  `pinQuestion` (organizers: `events:write`, entitlement `sessions`); `vote`, `askQuestion`,
  `upvoteQuestion` (the audience: `public:engagement`, published non-private events only).
  Queries `moderation` and `liveSessions` (`events:read`); public reads `publicLiveSession`,
  `participantState`, `liveSessionIds`, `displaySession`.
- **Realtime (M3.1b):** the platform registry gains a **session scope**
  (`org:{org}:event:{event}:session:{session}:{topic}`, topics ≤ 20 characters so names stay
  ≤ 160). Channels `session.live` (public, also the members' preview: approved questions, results
  only when shown, the stage) and `session.moderation` (members with `events:read`: the whole queue
  and live results). Every change publishes the full allowlisted shape inside the command's
  transaction; snapshots (`publicSnapshotTx`, `moderationSnapshotTx`) make a reconnecting screen
  whole; Last-Event-ID resumes replay what was missed. A session channel opens only for a real
  session of that event with engagement on (`sessionChannelOpen`).
- **Signed big-screen link:** `/display/{org}~{session}~{version}~{hmac}`. The page and its stream
  (`/api/engagement/display/{token}`) check the signature and the session's current version through
  `engagement.display_target` (SECURITY DEFINER, live orgs only, ids and version only).
  "Replace the link" bumps the version and revokes every earlier link.
- **Rate limits:** at most 5 questions per participant per session per 10 minutes (counted in the
  database, `rate_limited`), 2,000 questions and 50 polls per session; the web adds the
  `engagement` policy (60 actions a minute per device, 600 per anonymous IP, 6,000 per 10 minutes
  per IP; a room of phones shares one venue IP).
- **Events:** `engagement.vote_cast@1` (`{ eventId, sessionId, pollId }`) and
  `engagement.question_asked@1` (`{ eventId, sessionId, questionId }`) for M5.7b. No participant
  data.

**Web** (`apps/web`; UI only from `@yayatoh/ui` primitives and tokens, composed locally in
`src/components/engagement/`):
- **Moderator** `/o/{org}/e/{event}/sessions/{session}/live` (linked from each session on the
  console's sessions page, with a "Live Q&A" label when on): off → one primary action "Turn on polls
  and Q&A"; then the question queue (waiting for review, approved, dismissed), polls with live
  results and their controls, a new-poll form with inline validation, settings, and "Share" (the
  participant QR code and link, the big-screen link with copy and "Replace the link"). Viewers see
  it read-only (no controls, no big-screen link).
- **Presenter** `…/live/present`: the poll on stage with its results (even while hidden from the
  audience) and the current question, then the most upvoted questions; members only.
- **Participant** `/events/{slug}/live/{session}` (phone first, 44 px targets; linked from the
  public agenda as "Polls and Q&A" for sessions that have it, and from the QR code): open polls
  (the one on stage first), the ask form (name or anonymous; askers are told when moderators will
  see their name), approved questions with upvotes; every message inline; live with a status badge.
- **Big screen** `/display/{token}`: dark, large type; the poll on stage (results only when shown,
  otherwise "Vote now"), the current question, the top questions, the join QR; "High contrast" and
  "Reduced motion" toggles (also from `prefers-contrast` / `prefers-reduced-motion`, and
  `?contrast=high&motion=reduced` for keyboardless projectors); reconnects and catches up by itself.
- Messages: namespace `engagement` in all 13 locales (Arabic RTL).

### 4. Later / not yet
- **M5.7b:** session feedback at session end, `engagement_events` from votes and questions (the
  `engagement.*@1` events are ready), the engagement score.
- Editing a draft poll (delete and recreate for now); quizzes and leaderboards; downvotes; merging
  duplicate questions; replies; question character limits per session (fixed at 300).
- Debounced aggregate publishing for very large rooms (each vote publishes one message now; the
  M3.1b fan-out batches per process). Occupancy counts.
- Taking part in private or unlisted-but-gated events (access codes, ticket holders only); today
  only published, non-private events take part.
- A `/v1` engagement API for the mobile apps (additive, later; mobile apps are not built here).
- Profanity filtering of word-cloud entries and questions (moderation covers questions; words
  appear as typed, normalized).
- Retention of questions and tallies after the event (kept with the event today; DSAR/erasure
  needs nothing personal beyond an optional typed name).

### 5. Migration
`0099_glossy_tyger_tiger.sql` (renumbered at merge): new schema and six new tenant tables only, no
locks on existing tables. Hand-written block (between `-- hand-written: begin/end`): composite FKs
`session_settings`, `polls`, `questions` → `events.events` and `program.sessions` (cascade on
delete), and the SECURITY DEFINER function `engagement.display_target(org, session)` with its
REVOKE/GRANT. Platform change: none in SQL (the realtime log's 160-character channel CHECK already
fits session channels).

### 6. Acceptance (M5.7a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | One vote per person per poll under concurrency (16 parallel ballots from one key → 1 counted, 15 `already_voted`; 10 different people all count; ballots = tallies) | `packages/testing/tests/engagement.int.test.ts` ("one vote per person per poll, under concurrency"); e2e reload keeps "voted" |
| AC2 | Unapproved questions never reach public payloads: public state, snapshot and every `session.live` message carry approved questions only; a dismissed one is removed; nobody can upvote what they can't see | `engagement.int.test.ts` ("unapproved questions never reach public payloads…"); canary: pending bodies are `personal` (`private-columns.ts`) and `apps/web/e2e/canary-crawl.spec.ts` ("live polls and Q&A: the participant page, the big screen and the public stream carry no canary"); e2e (pending not on phone or big screen) |
| AC3 | The big screen recovers after a dropped connection with no missed state (replay by id in order; snapshot otherwise) | `engagement.int.test.ts` ("a big screen that drops its stream is replayed what it missed…"); `apps/web/e2e/engagement.spec.ts` (offline + server drop, a question approved meanwhile appears after reconnect) |
| AC4 | A cross-org channel attach is denied | `packages/platform/tests/realtime-session-channels.test.ts`; `engagement.int.test.ts` ("another org sees and changes nothing", `sessionChannelOpen`); e2e (moderation stream: 401 public, 403 another org's member; forged display link 404) |
| AC5 | Isolation; impersonation and freeze coverage | `isolation.int.test.ts` (fixture rows for both orgs in all six tables), `impersonation.int.test.ts` (`engagement.deletePoll` is a `delete` command), `freeze.int.test.ts` (every engagement command refused while frozen) |
| AC6 | Polls: single, multiple, rating, word cloud as counts; forward-only states; show results; present; delete | `packages/modules/engagement/tests/polls.test.ts`; `engagement.int.test.ts` (validation, states, word cloud, delete) |
| AC7 | Q&A: submit, upvote once, approve/dismiss, answer, pin; rate limits | `questions-tokens.test.ts`; `engagement.int.test.ts` ("upvotes once…", "rate limits questions…") |
| AC8 | Anonymous questions: never a name for the audience; kept for moderators only by policy; switching back erases | `engagement.int.test.ts` ("anonymous questions…"); e2e ("anonymous questions never show a name…") |
| AC9 | Signed display link; rotation revokes; forged/foreign tokens refused | `questions-tokens.test.ts`; `engagement.int.test.ts` ("signed display links…"); e2e (old link 404 after "Replace the link") |
| AC10 | E2E on all three projects: create and open a poll, vote from two contexts, results update live | `apps/web/e2e/engagement.spec.ts` ("create and open a poll, vote from two phones…") |
| AC11 | E2E: submit a question, moderate it, see it on the big screen | `engagement.spec.ts` ("a question is moderated onto the big screen…") |
| AC12 | E2E: keyboard only, axe on every screen and state, Arabic RTL | `engagement.spec.ts` ("keyboard only…", `expectAccessible` throughout, `/ar` participant, console and big screen) |
| AC13 | Viewer denied moderation (hidden controls, read-only settings, no display link; commands `forbidden`) | `engagement.int.test.ts` ("viewers read but never moderate…"); e2e ("a viewer can follow but not moderate…") |
| AC14 | Gated by the `sessions` module (P5-1), for organizers and the audience | `engagement.int.test.ts` ("a revoked sessions module refuses…") |
| AC15 | The public takes part only in published, public events whose session is on | `engagement.int.test.ts` ("is off until enabled…", "the public takes part only in published, public events") |

### 7. Gate results (2026-10-02, on merge/next-3f + m0.5-foundation as of 17:40 UTC)
- `pnpm lint`, `pnpm check:modules`: clean. Typecheck (`turbo run typecheck --concurrency=2`): 57/57.
- Unit: 183 files, 2,325 tests passed (engagement: 18 new, incl. the platform session-channel tests).
- Integration: 146 files, 1,311 of 1,312 passed. The one failure, `apps/worker/tests/badges.int.test.ts` "the leader tick queues the batch until its PDF is done" (M5.5a, merged just before), timed out under full-suite load and passes alone (2/2); unrelated to engagement. `engagement.int.test.ts`: 15 tests.
- E2E (375/768/1280, `--workers=2`): `engagement.spec.ts` (5 tests × 3), plus `agenda`, `program`, `realtime`, `canary-crawl` (incl. the new live-engagement leak test) and `events`: 85 passed. Earlier in the session `seat-live`, `command-center`, `alerts`, `a11y`, `security` and `program-media` also passed against this change.
- `agent/design-v2` merge: conflicts outside this feature (messages, the exhibitors and speakers pages, `public-event-view.tsx`, drizzle meta 0096, owner inbox), so it was aborted; the merge session will take it. The new screens use only `@yayatoh/ui` primitives and tokens.

## M5.7b — Feedback and engagement score (done)

### 1. Goal and users
Organizers see who took part most in an event and how each session went, and target the most (or
least) engaged people with audiences. **Attendees** are asked for feedback on the live session page
once the session is over. **Owners and admins** (`org:update`) set how much each kind of
engagement counts for their organization; anyone who may read attendees (`attendees:read`: owners,
admins, managers, viewers, event managers) sees the scores.

### 2. References
- **Phase 5 plan:** Wave 3 row M5.7b ("session feedback prompt at session end (reusing M3.9a session
  surveys); `engagement_events` from scans, polls, Q&A, feedback, enrollments; an engagement score
  per attendee and session (documented formula, org-adjustable weights), fed to M3.6a audiences";
  acceptance "the fixture attendee's score reproduces exactly; feedback is one response per person").
- Builds on M5.7a (polls and Q&A), M3.9a (surveys), M5.2b (enrollments), M3.4a/M1.8 (door scans),
  M3.6a (audiences, crm segment DSL).

### 3. Scope (built)
**The formula** (`packages/modules/engagement/src/domain/score.ts`, pure):
`score = Σ weight(kind) × count(kind)` over five kinds, per attendee per event:
`check_in` (1 when any of their tickets was admitted; several tickets or re-entries count once),
`poll_vote` (polls voted in), `question` (named questions asked), `feedback` (surveys answered:
session feedback and post-event), `enrollment` (optional sessions they hold a place in). A
session's score is the same sum over what happened in it; its participants are the distinct
people. Weights are whole points 0–100 per kind, per org; defaults check-in 10, poll vote 2,
question 3, feedback 5, enrollment 1.

**Module `engagement`** (tier 5):
- `engagement_events`: one row per thing an attendee did (`event_id`, `contact_id`, `session_id`,
  `kind`, `source_ref`, `occurred_at`), unique per (contact, kind, source) so nothing counts
  twice. Never a choice, an answer or an anonymous question. Composite FKs to `events.events`
  (cascade), `program.sessions` (set null: the facts still count) and `crm.contacts` (cascade).
- `score_weights`: the org's weights (no row: the defaults). `setScoreWeightsCommand` /
  `resetScoreWeightsCommand` (`org:update`, audited) recompute every score of the org in the same
  transaction; `scoreWeightsQuery` (`events:read`).
- Sources: live polls and named questions are logged inside the vote/ask commands when the actor
  is a signed-in account whose contact (by account link, else email) is an active attendee of the
  event (`recordLiveActivityTx`; a device, a visitor who isn't attending, an account that isn't
  the actor, and every anonymous question are never scored). The `engagement.activity` subscriber
  (worker and dev drain) turns `ticket.admitted@1` / `ticket.admission_undone@1`,
  `survey.responded@1`, `registration.session.promoted@1` and the new
  `registration.session.enrollment_changed@1` into facts (an undone admission or a dropped
  session takes its fact back). Exactly once per event and idempotent besides.
- Each change rescores that attendee and writes `crm.event_engagement` in the same transaction.
- `eventScoresQuery` (`attendees:read`): the top 50 attendees by score (name, email, score, counts)
  and every session's participants, score and counts, recomputed from the log with the current
  weights.

**crm** (tier 1): `event_engagement` (contact × event score, FORCE RLS, written only through
`replaceEventEngagementTx`), `contactForAccountTx`, and the segment condition
`{ type: 'engagement', scope, op, value }`: the sum of the contact's scores over the events in
scope, compared with a whole number (bound parameter).

**surveys** (M3.9a): `feedbackPromptQuery` and `openFeedbackCommand` (`public:survey`): once a
session's feedback survey can be answered (open, with questions, the session over, the event
published and public), the signed-in attendee gets their invitation: the one an emailed send
already gave them, or a new one recorded as a `prompt` send (no email). One invitation and one
response per person per survey still hold. `survey.responded@1` now also carries `contactId` and
`sessionId` (additive).

**registration** (M5.2b): emits `registration.session.enrollment_changed@1`
(`{ eventId, sessionId, registrantId, status: enrolled | dropped }`) when a registrant enrolls
directly, accepts an offer or drops a session.

**Web:**
- Live session page (`/events/{slug}/live/{session}`): the feedback card after the session ends:
  "Give feedback" (to the survey link), "Sign in" for visitors (back to the page after), "Thanks,
  your feedback is in." once answered, and the refusals (already answered, expired). Votes and
  named questions of a signed-in person carry their account (never while impersonating).
- Console `/o/{org}/e/{event}/engagement` (linked from Sessions): engaged attendees and average
  score, the most engaged attendees, the sessions table, the formula and the weights form
  (owners/admins; read-only for others), inline validation and success messages.
- Audience builder: "Engagement score" condition (scope, comparison, score).
- Dev only: `/api/dev/engagement` (an ended live session with a feedback survey and a registered
  attendee) for the e2e.
- Messages: `engagement.scores.*`, `engagement.feedback.*`, `audiences.builder.types.engagement`,
  `audiences.builder.engagementScore` in all 13 locales.

### 4. Later / not yet
- Session check-in scans (M5.6a) are not a source yet: only the event door (`ticket.admitted`).
  When M5.6a lands, its session scans become a sixth kind (or count as `check_in` per session).
- Enrollments that end for other reasons (organizer moves, cancelled tickets, lapsed offers) keep
  their fact; only a drop by the attendee takes it back.
- Anonymous questions are never scored; upvotes are not scored.
- Scores are per event; there is no per-attendee page yet (the scores page and audiences only),
  and no export of scores.
- The prompt lives on the live session page, so it shows for sessions with live polls/Q&A on; an
  automatic feedback email at session end is not built (organizers send it from Surveys).
- Weight changes rescore the whole org in one transaction (fine at today's sizes; a bulk job later).
- Data-subject exports (M1.14c) don't list engagement scores or facts yet (they hold no answers,
  only counts and ids); erasure keeps them on the pseudonymized contact.

### 5. Migration
`0113_curvy_warlock.sql` (renumbered at merge): three new tenant tables (`crm.event_engagement`,
`engagement.engagement_events`, `engagement.score_weights`) with FORCE RLS and the NULLIF policy.
Hand-written block: `surveys.sends.sends_source_check` widened to `'prompt'` (dropped, re-added
`NOT VALID`, then `VALIDATE`); composite FKs `engagement_events` → `events.events` (cascade),
`program.sessions` (`ON DELETE SET NULL (session_id)`) and `crm.contacts` (cascade).

### 6. Acceptance (M5.7b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The fixture attendee's score reproduces exactly (both orgs: 8 + 3 + 4 + 6 = 21 with the fixture weights; crm row and query agree; replaying events changes nothing) | `packages/testing/tests/engagement-score.int.test.ts` ("reproduces the fixture attendee's score exactly…", "handling the same outbox events again…"); `packages/modules/engagement/tests/score.test.ts` |
| AC2 | Feedback is one response per person (one invitation per person through the prompt; 6 parallel submits → 1 ok, 5 `already_answered`; the prompt then says answered; scored once) | `engagement-score.int.test.ts` ("one invitation and one response per person, even under concurrency…"); e2e (answered once, the prompt thanks after reload) |
| AC3 | The prompt appears only after the session ends, only for attendees (sign-in for visitors, nothing for others or a closed survey), and sends no email | `engagement-score.int.test.ts` (session feedback block); e2e |
| AC4 | Sources: votes and named questions of signed-in attendees, door scans (once; undo takes it back), answered surveys, enrollments (drop takes it back); devices, non-attendees, mismatched accounts and anonymous questions unscored | `engagement-score.int.test.ts` ("sources" block, "an undone admission…") |
| AC5 | Session scores and participants | `engagement-score.int.test.ts` ("session scores add up…"); e2e (Closing panel row) |
| AC6 | Org-adjustable weights: validation, owners/admins only, rescoring at once, reset; the other org untouched | `engagement-score.int.test.ts` ("follows the weights…", "weights are whole points…"); e2e (keyboard, inline error, persistence, reset) |
| AC7 | Fed to audiences: the engagement condition (validation, bound SQL, scope) finds the fixture attendee at ≥ 21 and not at ≥ 22 | `packages/modules/crm/tests/segments.test.ts` ("engagement condition"); `engagement-score.int.test.ts` ("the engagement condition finds…"); e2e (builder: 1 person at ≥ 7, 0 at ≥ 8) |
| AC8 | Permissions and isolation (scores need `attendees:read`; another org's event `not_found`; fixture rows for both orgs in all three tables) | `engagement-score.int.test.ts`; `isolation.int.test.ts` (fixture rows) |
| AC9 | E2E on all three projects: keyboard only, `expectAccessible` light and dark, Arabic RTL (scores page, participant prompt), viewer read-only, a lower role refused (no link, 404) | `apps/web/e2e/engagement-score.spec.ts` (3 tests × 3 projects) |

### 7. Gate results (2026-10-03, on m0.5-foundation + merge/next-3g + merge/next-3h)
- `pnpm lint`, `pnpm check:modules`: clean. Typecheck (`turbo run typecheck --concurrency=2`): 59/59.
- Unit: 200 files, 2,700 tests (2 failures at first: the console route sweep needed the new
  `engagement` route registered under the `sessions` section; fixed, 139/139 in that file).
- Integration (from zero, incl. isolation): 165 files, 1,515 tests passed;
  `engagement-score.int.test.ts`: 15.
- E2E (375/768/1280, `--workers=2`): `engagement-score.spec.ts` 9/9; related `engagement`,
  `surveys`, `audiences`, `enrollment`, `agenda`, `program`: 93 passed.
