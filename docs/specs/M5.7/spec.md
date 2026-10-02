# Spec: M5.7 — Live engagement

- **Milestone:** M5.7 (roadmap Phase 5, "M5.7 Live engagement"; Phase 5 plan `docs/plans/phase-5.md`, Wave 2: M5.7a, Wave 3: M5.7b)
- **Status:** M5.7a built (2026-10-02); M5.7b (session feedback and the engagement score) follows in Wave 3
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
`0095_moaning_pretty_boy.sql` (renumbered at merge): new schema and six new tenant tables only, no
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
