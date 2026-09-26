# Engagement Surveys Polls Networking

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

engagement-surveys-polls-networking

# Engagement, Surveys, Polls and Networking for Yayatoh 2.0

Grounded in the vision document (section 5 "Attendee engagement / Surveys / Polls / Networking", section 8 "After event → Survey", the "Engage" lifecycle step, and section 11 attendee history/CRM). Research date: 2026-09-26. Web search budget was exhausted mid-task, so vendor detail comes from direct fetches of vendor pages; where a page was blocked (403/502) or hid pricing behind a quote form, the item is marked UNVERIFIED.

## 1. How the incumbents do it

| Vendor | Live polls / Q&A | Feedback & surveys | Directory, meetings, matchmaking | Gamification | Pricing (verified?) |
|---|---|---|---|---|---|
| **Slido** | Polls, quizzes, word clouds; Q&A with upvoting, optional downvoting, moderation queue ("enable moderation"), question character limits, "how many questions appear in Present mode" (community.slido.com Q&A settings). Present mode = big-screen view; PowerPoint/Google Slides/Teams/Webex plugins. | Multi-question surveys (post-session) | None | Quizzes with leaderboard | Pricing table is rendered client-side and could not be fetched. From prior knowledge: free tier ~100 participants, paid one-time and annual plans; moderation gated to paid. UNVERIFIED. |
| **Mentimeter** | Polls, Q&A, quizzes; Q&A moderation ("pre-approve questions before they are shown") only on Pro+ | Surveys, segmentation of results (Basic+) | None | Quiz leaderboards | Verified: Free (50 monthly participants), Basic $11.99/presenter/mo, Pro $24.99/presenter/mo (annual only), Enterprise custom; SSO/SCIM/LMS enterprise-only. |
| **Cvent Attendee Hub** | "Chat, Q&A, polls & surveys" in sessions | Session surveys, post-event feedback; "Surveys Premium" is a paid add-on | Attendee directory, Appointments (1:1 scheduling), "CventIQ" AI networking, discussion groups, activity feed | Challenges, leaderboards, reactions | Quote-only. Professional tier licenses Registration / Attendee Hub / OnArrival separately with 15 logins; Enterprise bundles all plus API, SSO, MFA. Same features on web and native app; web/mobile split not documented. |
| **Swapcard** | Polls and Q&A in sessions | Not prominent | Strongest here: AI matchmaking ("Sherlock AI" using profile plus session views/searches as buying signals), connection requests, one-tap chat, organizer-defined **Meeting Slots**, **Meeting Locations** (physical venues, booths, virtual), **Meeting Request Rules**, attendance/no-show tracking, Hosted Buyer optimisation (help.swapcard.com Meetings collection) | Light | Starter (≤1,000 attendees/yr), Professional (≤10,000), Enterprise; "licensing fees + per-user rates"; branded/white-label app is an add-on. No dollar figures. Claims 70-80% adoption web+mobile. |
| **Whova** | Live polling, session Q&A | "Mobile survey and session feedback"; post-event survey | Attendee SmartProfiles, matchmaking, 1:1 Meeting Scheduler, business-card exchange, 1:1/group chat, video calls, speed networking, Community Board (meet-ups, icebreakers); FAQ confirms attendees can "opt themselves out from the list" | Passport contest ("double booth traffic"), photo contest, leaderboard, icebreakers | Quote-only, priced by event type/duration/attendee count/frequency. Most engagement is in the native app; a web app exists but per-feature split is not published. UNVERIFIED. |
| **Bizzabo** | Polls, Q&A, surveys | Surveys | AI matchmaking on "hundreds of data points" (registration, content engagement, interests); 1:1 meetings on the personal agenda with organizer blackout during keynotes; searchable directory; DM/chat; sponsor lead tools; Klik NFC SmartBadge | Gamification mechanics | Quote-only. Web and mobile both supported. |
| **RainFocus** | Not detailed publicly | Session surveys implied under "Attendee Engagement" module | "Meetings Management", personalized content recommendations; behavioural data feeds lead qualification and pipeline analytics | Not documented | Quote-only; product pages 403'd. UNVERIFIED beyond platform overview. |

Takeaways: (a) every competitor exposes engagement on both web and native, with Whova the most app-centric; (b) Q&A moderation is a paid-tier differentiator at Slido and Mentimeter; (c) Swapcard's slot/location/request-rule model is the reference design for meetings; (d) all of them compute an engagement signal from behaviour, which is exactly what section 11 of the vision wants in `person_stats`.

## 2. Shared question/form engine (P0 foundation)

One engine serves registration forms, RSVP questions, session feedback, post-event surveys, and single-question live polls. This is the biggest leverage point in the whole topic.

**Schema (own JSON, versioned):**
- `forms(id, tenant_id, event_id?, kind ENUM('registration','rsvp','session_feedback','post_event_survey','poll','quiz','custom'), title, status, settings jsonb)`
- `form_versions(id, form_id, version, schema jsonb, published_at)` — never mutate a published version; responses reference the version.
- `schema` structure: `{ pages: [{ id, title, visibleIf?, blocks: [{ id, type, label, required, options?, validation?, visibleIf?, enableIf?, i18n: {en:{...}, es:{...}} }] }] }`. Block types for P0: short_text, long_text, email, phone, number, single_choice, multi_choice, dropdown, rating (1-5, 1-10, NPS 0-10), date, checkbox_consent, file_upload, hidden, matrix (P1), ranking (P1), signature (P1).
- **Conditional logic**: store `visibleIf`/`enableIf`/`requiredIf` as JsonLogic (`json-logic-js`, MIT) expressions over answer ids and context variables (`ticket_type`, `attendee_type`, `session_track`). JsonLogic evaluates identically in TypeScript (web), Swift and Kotlin (native), which is why it beats SurveyJS's proprietary expression language for our cross-platform need. Also support `skipTo` page branching and answer piping (`{{q.first_name}}`).
- i18n lives inside the schema per block, matching the 12-language UI requirement.

**Response storage:**
- `form_responses(id, tenant_id, form_id, form_version_id, person_id?, order_id?, registration_id?, session_id?, channel ENUM('web','pwa','ios','android','kiosk','email_link'), started_at, submitted_at, locale, meta jsonb)`
- `form_answers(response_id, block_id, value_text, value_number, value_json, option_ids text[])` — normalized rows so analytics are SQL, not JSON scanning. Keep the raw `answers jsonb` on the response too for exports.
- Unique index `(form_id, person_id)` when `settings.one_per_person = true` (feedback/surveys); registration forms are one per registration.

**Renderer:** build a `FormRenderer` package (`@yayatoh/forms`) on react-hook-form 7 + zod 4, generating the zod schema from the form JSON at load time. Runner-up: **SurveyJS Form Library** (MIT renderer; Survey Creator is $589/dev perpetual, Dashboard/PDF extra) — excellent drag-and-drop designer, but its expression language and theme system are not portable to the native apps and the Creator UI is hard to white-label deeply. **Formbricks** (AGPLv3 core, Pro cloud $74/mo for 2,000 responses) lost because AGPL contaminates a white-label SaaS and it is a separate app rather than an embeddable engine. Build the organizer-side form builder ourselves (drag-drop with dnd-kit); it is a bounded UI on top of the JSON schema.

**Analytics:** per-form summary materialised nightly and on demand: response rate (responses / targeted persons), completion time, per-block distributions, NPS calc, rating averages by session/speaker/track, free-text theme clustering (P1, LLM). Session feedback ratings roll into `sessions.avg_rating` and `speakers.avg_rating`.

## 3. Live polls and Q&A on the Ably realtime layer (P0 for conferences, module-gated)

**Channel naming (tenant-scoped, one Ably app):** `t.{tenantId}.ev.{eventId}.s.{sessionId}.poll`, `...s.{sessionId}.qa`, `...ev.{eventId}.display` for the big screen. Token auth issues capabilities per role: attendees `subscribe` only; moderators/presenters `subscribe`+`publish` on control messages; the server publishes all authoritative state via REST.

**Polls (server-authoritative):** votes are POSTed to the API (idempotent on `(poll_id, person_id)`; anonymous polls key on a signed device token), written to `poll_votes`, and a debounced worker (every 250 ms while active) publishes `{poll_id, counts, total}` to the poll channel. Late joiners call `GET /polls/:id` for the snapshot, then subscribe with `rewind=1` (Ably rewind is capped at 100 messages and ~2 minutes without persistence, 72 h with persistence on paid plans) so the last aggregate arrives immediately. Ably **LiveObjects** `LiveCounter` is the alternative (state streamed to late joiners automatically); it is listed as a product alongside Pub/Sub but its GA status/plan availability could not be verified, so treat it as P1 optimisation. Never let clients publish votes directly to Ably: fraud prevention and one-vote enforcement must be in Postgres.

**Q&A:** `qa_questions(id, session_id, person_id?, is_anonymous, body, status ENUM('pending','approved','highlighted','answered','archived','rejected'), upvotes int, created_at)`, `qa_upvotes(question_id, person_id) PK`, `qa_replies` (P1, presenter written answers). Organizer settings per session mirror Slido: moderation on/off (pending queue), allow anonymous, allow downvote, max characters (default 300), max questions shown on screen, close Q&A at time. Server publishes deltas (`question.created/updated`, `upvote.changed`) on the qa channel; upvote counts are debounced. Audience size uses Ably **occupancy** (`[meta]occupancy` connections/subscribers), not presence: presence defaults to 200 members per channel and is n-squared under load.

**Views (all web/PWA):** Participant view (`/live/:sessionCode`, also embedded in the native app as a webview or native screen, section 8), Moderator view (`/app/events/:id/sessions/:id/qa`: approve/reject/merge/highlight/mark answered/pin), Presenter view (compact, phone-friendly, "next question"), and Big-screen view (`/display/:eventId/:sessionId?token=...`, full-screen, kiosk-safe, auto-rotates polls/Q&A/announcements; reuses the kiosk/display mode planned for weddings). Join via short code and QR on session signage; non-registered walk-ins get a guest identity with no PII.

**Cost:** Ably Standard is $29/mo plus usage ($2.50 per million messages, 10k peak connections, 64 KiB messages); a 2,000-person session with 20 polls and 200 questions is well under 1 million messages if aggregates are debounced. Pro ($399/mo, 50k connections) only for large tenants.

## 4. Networking module (P1, conference module only)

**Opt-in directory:** `networking_profiles(person_id, event_id, opted_in bool default false, visibility ENUM('all_attendees','connections_only','hidden'), headline, company, bio, interests text[], looking_for text[], show_email bool, show_phone bool, allow_meeting_requests bool, allow_messages ENUM('anyone','connections','nobody'), consent_id)`. Default is opted-out; the organizer can pre-tick "opted in" only via the registration form consent block with clear purpose text (GDPR Art. 6(1)(a) consent, recorded in `consents` with timestamp, form version and wording). Directory search filters by role/company/interests/track and never exposes email/phone unless the owner enabled it. Export and erasure flows (existing CRM module) must cover networking data, messages and meetings.

**Connections:** `connections(requester_id, addressee_id, event_id, status ENUM('pending','accepted','declined','blocked'))`; QR-to-QR "exchange card" from the badge/ticket QR (Whova/Bizzabo Klik equivalent, no hardware).

**Meetings (Swapcard model):** organizer defines `meeting_slots(event_id, starts_at, ends_at, duration_min)` and `meeting_locations(event_id, name, kind ENUM('table','booth','room','virtual'), capacity, floorplan_object_id?)` — the floorplan object link reuses the seating engine's tables so a "Networking Lounge, Table 7" appears on the interactive venue map and in Seat Finder. `meetings(requester_id, invitee_id, slot_id, location_id, status ENUM('requested','accepted','declined','cancelled','no_show','completed'), note)`. Rules: no double-booking per person or location-capacity per slot; organizer blackout during keynotes (Bizzabo); reminders 15 min before via push/SMS through the notification engine; accepted meetings appear on the personal agenda and in the check-in scanner (mark attended by scanning both QRs, P2).

**Chat:** replace the existing 1:1 chat with **Ably Chat** (SDKs for JS, React, React Native, Swift, Kotlin; latest JS release seen 1.4.0, 29 May 2025, likely newer now; UNVERIFIED current version). Room id = `t.{tenant}.ev.{event}.dm.{sortedPersonIdA}_{B}`; messages persist in Ably history and are mirrored to `chat_messages` via the Ably webhook integration so reports and erasure work from our DB. Moderation: after-publish moderation by default (Hive/Tisane/Azure Content Safety/custom Lambda integrations), before-publish for tenants that require it (education, government); `user_blocks(blocker_id, blocked_id)` enforced in the token capability (blocked user cannot obtain a token for that room) and `abuse_reports(reporter_id, target_person_id, room_id, message_id, reason, status)` queued to the organizer moderation inbox with tenant-level ban. Runner-up **Stream Chat** ($399/mo for 10k MAU, richer built-in moderation dashboard) lost on cost and on adding a second realtime vendor next to Ably.

**AI matchmaking (P1 after directory):** embed `headline + bio + interests + looking_for + registered session titles` with a hosted embedding model into a `vector(1536)` column using **pgvector** (v0.8.x, HNSW index, cosine operator `<=>`, Postgres 13+). Recommendations = top-k cosine neighbours among opted-in profiles in the same event, re-ranked by explicit rules (same company down-weighted, "looking_for" ↔ "offers" cross-match up-weighted, mutual session overlap). Cold start uses tag Jaccard. Embedding cost is negligible per event (a few thousand short profiles); exact per-token price UNVERIFIED (pricing page blocked).

**Gamification (P2):** `challenges(event_id, kind ENUM('visit_booths','attend_sessions','answer_polls','make_connections','photo'), points)` and `challenge_progress`; the "passport" is booth-QR scans via the existing check-in scanner code path; leaderboard on the big-screen view.

## 5. Survey delivery through marketing automation

Post-event survey is a form of kind `post_event_survey` linked to an automation: trigger `event.ended` (+ configurable delay, default +2 h), audience = checked-in attendees (optionally no-shows get a different survey), channel = email first, SMS/WhatsApp fallback after 48 h if unanswered, stop when `form_responses` exists. Links carry a signed, single-use token (`/s/:formSlug?t=…`) that pre-identifies the person and locale, so no login is needed and one-response-per-person is enforced. Session feedback is pushed in-app 5 minutes before session end (native push or PWA web push) and stays on the agenda card until answered. Both are just automation templates shipped with the conference module; the org can edit wording and timing.

## 6. Feeding `person_stats.engagement_score`

Every module writes to one append-only `engagement_events(id, tenant_id, person_id, event_id, session_id?, type, weight, occurred_at, source)` with defaults: session check-in 10, poll vote 2, question asked 3, question upvoted (received) 1, feedback submitted 5, survey submitted 8, connection accepted 4, meeting completed 10, booth scan 3, email open 1, email click 2, no-show at meeting −5. A nightly job (and an on-demand recompute) sets `person_stats.engagement_score = Σ weight × decay(0.5^(months/12))`, plus `last_engaged_at` and per-event `event_engagement`. This is what powers audiences like "highly engaged last year, not registered this year" in section 8 and the CRM history in section 11.

## 7. PWA/web vs native app

Web/PWA: all organizer tooling, form builder, analytics, moderator/presenter/big-screen views, participant poll/Q&A and survey pages (deep-linkable, no install), directory and meeting booking. Native apps (existing iOS/Android via the stable API): participant poll/Q&A, session feedback prompts, directory, chat (Ably Chat native SDKs), meetings with push reminders, QR card exchange, offline agenda. Nothing is native-only; native adds push and camera. All endpoints are versioned `/api/v1/engagement/*` and documented in OpenAPI on day one so the mobile team can build in parallel.

## 8. P0 / P1 split

**P0 (ship with the conference module MVP):** form engine with conditional logic and normalized answers; registration/RSVP questions on it; session feedback and post-event survey templates plus automation delivery; live polls and moderated Q&A with participant/moderator/big-screen views; engagement_events and score.
**P1:** opt-in directory with consent, connections, meeting slots/locations/requests, Ably Chat with block/report, quizzes with leaderboard, matchmaking via pgvector, free-text theme summarisation.
**P2:** gamification/passport, QR-to-QR card exchange with meeting attendance, LiveObjects migration, before-publish moderation tier.


## Key recommendations

- Build one JSON form engine (forms/form_versions/form_responses/form_answers) with JsonLogic conditional logic and reuse it for registration, RSVP, session feedback, post-event surveys and polls; render with react-hook-form + zod on web and the same JSON on native.
- Keep polls and Q&A server-authoritative: votes/questions go to the API and Postgres, the server publishes debounced aggregates to tenant-scoped Ably channels; clients only subscribe.
- Use Ably occupancy (not presence) for audience counts; presence is capped at 200 members by default and scales n-squared.
- Ship four web views for live engagement: participant (/live/:code), moderator, presenter, and a token-protected big-screen /display view that reuses the kiosk mode planned for weddings.
- Model networking meetings on Swapcard: organizer-defined meeting slots, meeting locations tied to floorplan objects, request rules, blackout during keynotes, no-show tracking.
- Make the attendee directory opt-in by default with a purpose-specific consent record, per-field visibility, and erasure/export coverage for messages and meetings.
- Replace the existing 1:1 chat with Ably Chat (native and web SDKs), mirror messages to Postgres via webhook, enforce blocks in token capabilities, and route abuse reports to an organizer moderation inbox.
- Deliver post-event surveys as an automation template (event.ended + delay, signed single-use link, SMS/WhatsApp fallback, stop on response) rather than a bespoke feature.
- Log every engagement action to an append-only engagement_events table and compute person_stats.engagement_score nightly with time decay.
- Do matchmaking with pgvector cosine similarity over profile embeddings inside Postgres; no separate vector database.
- Prefer an own form builder over SurveyJS Creator ($589/dev) or Formbricks (AGPL) to keep white-label control and cross-platform portability.
- Gate polls, Q&A, networking and gamification behind the conference module so weddings and concerts never see them.


## Data model implications

- forms, form_versions (immutable published schema jsonb with i18n and JsonLogic visibleIf/enableIf/requiredIf), kind enum covering registration/rsvp/session_feedback/post_event_survey/poll/quiz/custom
- form_responses (person_id, registration_id, order_id, session_id, channel, locale) and normalized form_answers (block_id, value_text/number/json, option_ids) plus unique (form_id, person_id) when one_per_person
- polls, poll_options, poll_votes (unique poll_id+person_id or device token) with aggregate counts published to Ably
- qa_questions (status enum pending/approved/highlighted/answered/archived/rejected, is_anonymous), qa_upvotes PK(question_id, person_id), qa_replies; per-session qa_settings
- networking_profiles (opted_in default false, visibility enum, per-field show flags, allow_messages, consent_id) and consents (purpose, wording, form_version, timestamp)
- connections (requester, addressee, status incl. blocked), user_blocks, abuse_reports
- meeting_slots, meeting_locations (kind, capacity, floorplan_object_id FK to seating objects), meetings (status incl. no_show), agenda integration
- chat_rooms and chat_messages mirrored from Ably Chat via webhook, soft-delete flag for moderation
- profile_embeddings vector(1536) with HNSW index (pgvector) per event
- engagement_events append-only (type, weight, occurred_at, source) and person_stats.engagement_score, last_engaged_at, per-event engagement rollups
- sessions.avg_rating and speakers.avg_rating derived from session_feedback responses
- challenges and challenge_progress for gamification (P2), booth scans reuse check-in scan records
- Ably token capabilities derived from role and block lists; channel names carry tenant and event ids


## Risks

- Vendor pricing for Slido, Whova, Cvent, Bizzabo, RainFocus and Swapcard is quote-based or client-rendered; competitive pricing benchmarks in this report are partly UNVERIFIED.
- Ably LiveObjects GA status and limits could not be verified; keep it out of the P0 path and use REST snapshot + rewind instead.
- Ably Chat JS SDK version cited (1.4.0, May 2025) may be stale; confirm current version and React Native/Swift parity before committing the native chat rewrite.
- Anonymous polls/Q&A for walk-ins require a device-token identity; without care this weakens one-vote enforcement and fraud detection.
- Chat and directory introduce GDPR/CCPA obligations (consent, erasure, data export, moderation of user content) that the current ticketing platform does not carry today.
- Ably message volume can spike if aggregates are published per vote instead of debounced; enforce the 250 ms debounce server-side.
- A single shared form engine becomes a critical dependency for registration; schema versioning and migration discipline are mandatory.
- Free-text moderation providers (Hive, Tisane, Azure Content Safety) add per-message cost and latency; before-publish mode must be opt-in per tenant.
- Building the organizer form builder in-house is a real UI investment; underestimating it delays registration forms, not just surveys.


## Open questions

- Should the existing Yayatoh 1:1 chat's message history be migrated into the new chat, or can it be archived read-only?
- Do you want the attendee directory opted-in by default for conference events (with clear consent at registration) or opted-out by default across all tenants?
- Which tenants require before-publish (pre-moderated) chat and Q&A, and will that be a paid tier?
- Are polls/Q&A expected inside the existing native apps at launch, or is a web participant page acceptable for the first release?
- Is anonymous participation (no ticket, join by session code) acceptable for polls and Q&A, or must every participant be a registered attendee?
- Do you want engagement score weights configurable per organization, or fixed platform-wide?
- Should meeting locations be sold to sponsors (branded lounges, booth meetings with lead capture) in the first networking release?
- What is the retention period for chat messages, survey responses and engagement events per tenant?
- Which embedding provider is acceptable for matchmaking given data-residency expectations of your enterprise tenants?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
- https://www.mentimeter.com/plans
- https://community.slido.com/q-a-settings-222
- https://community.slido.com/
- https://www.slido.com/pricing (pricing table not retrievable; UNVERIFIED)
- https://www.cvent.com/en/event-marketing-management/attendee-hub
- https://www.cvent.com/en/event-management-software/cvent-pricing
- https://www.swapcard.com/pricing
- https://www.swapcard.com/
- https://help.swapcard.com/en/collections/5490962-meetings
- https://whova.com/features/
- https://whova.com/faq/
- https://whova.com/pricing/
- https://www.bizzabo.com/event-networking-platform
- https://www.rainfocus.com/platform/
- https://ably.com/pricing
- https://ably.com/docs/channels/options/rewind
- https://ably.com/docs/presence-occupancy/presence
- https://ably.com/docs/presence-occupancy/occupancy
- https://ably.com/docs/liveobjects
- https://ably.com/liveobjects
- https://ably.com/docs/chat
- https://ably.com/docs/chat/moderation
- https://github.com/ably/ably-chat-js/releases
- https://surveyjs.io/pricing
- https://formbricks.com/pricing
- https://github.com/formbricks/formbricks
- https://getstream.io/chat/pricing/
- https://github.com/pgvector/pgvector
